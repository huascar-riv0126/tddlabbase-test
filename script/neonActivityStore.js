import 'dotenv/config';
import pg from 'pg';
import { ensureSafeRemoteUrl } from './db-security.js';

const { Pool } = pg;

function dateOnly(value) {
  const date = new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) {
    throw new Error('La fecha de actividad no es válida.');
  }
  return date.toISOString().slice(0, 10);
}

function repositoryParts(repository) {
  if (!repository?.slug || typeof repository.slug !== 'string') {
    throw new Error('Falta el identificador del repositorio.');
  }
  const parts = repository.slug.split('/');
  if (parts.length < 2 || parts.some(part => !part)) {
    throw new Error('El repositorio debe tener el formato propietario/nombre.');
  }
  const repoName = parts.pop();
  return {
    owner: parts.join('/'),
    repoName,
    repoUrl: repository.remoteUrl || `https://github.com/${repository.slug}`,
  };
}

export class NeonActivityStore {
  constructor({ pool } = {}) {
    if (!pool) {
      if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL no está configurada para guardar actividad en Neon.');
      }
      ensureSafeRemoteUrl(process.env.DATABASE_URL);
    }
    this.pool = pool || new Pool({ connectionString: process.env.DATABASE_URL });
    this._initialized = false;
    this._initializing = null;
    this._closed = false;
  }

  async initialize() {
    if (this._initialized) {
      return;
    }
    if (!this._initializing) {
      this._initializing = this.pool.query(`
        SELECT r.id, r.repos_name, r.repo_url, r.owner,
               b.id, b.name, b.fork_commit_sha, b.created_at, b.repo_id,
               c.sha, c.parent_sha, c.branch_id, c.author, c.message, c.committed_at,
               e.id, e.commit_sha, e.tests_total, e.tests_passed, e.tests_failed, e.executed_at,
               m.id, m.source_branch_id, m.target_branch_id, m.source_commit_sha,
               m.merge_commit_sha, m.is_fast_forward, m.merged_at
        FROM public.tdd_repository r
        CROSS JOIN public.tdd_branch b
        CROSS JOIN public.tdd_commit c
        CROSS JOIN public.tdd_execution e
        CROSS JOIN public.tdd_merge m
        LIMIT 0
      `).then(() => {
        this._initialized = true;
      });
    }
    await this._initializing;
  }

  async close() {
    if (!this._closed) {
      await this.pool.end();
      this._closed = true;
      this._initialized = false;
      this._initializing = null;
    }
  }

  async withTransaction(callback) {
    await this.initialize();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        error.rollbackError = rollbackError;
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async saveTestExecution({ repository, branch, commit, execution }) {
    return this.withTransaction(async client => {
      const repositoryId = repository ? await this.upsertRepository(client, repository) : null;
      const branchId = repositoryId && branch?.name
        ? await this.upsertBranch(client, repositoryId, branch)
        : null;
      const commitSha = commit?.sha || null;

      if (commitSha) {
        await this.upsertCommit(client, {
          ...commit,
          branchId,
        });
      }

      const result = await client.query(
        `INSERT INTO public.tdd_execution
          (commit_sha, tests_total, tests_passed, tests_failed, executed_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          commitSha,
          execution.testsTotal,
          execution.testsPassed,
          execution.testsFailed,
          dateOnly(execution.executedAt),
        ]
      );
      return result.rows[0].id;
    });
  }

  async savePushActivity(payload) {
    return this.withTransaction(async client => {
      const repositoryId = await this.upsertRepository(client, payload.repository);
      const branchIds = new Map();
      let branchesSaved = 0;
      let commitsSaved = 0;
      let mergesSaved = 0;

      for (const branch of payload.branches || []) {
        const result = await this.upsertBranch(client, repositoryId, branch, true);
        branchIds.set(branch.name, result.id);
        if (result.inserted) {
          branchesSaved += 1;
        }
      }

      for (const commit of payload.commits || []) {
        let branchId = branchIds.get(commit.branch);
        if (!branchId && commit.branch) {
          branchId = await this.upsertBranch(
            client,
            repositoryId,
            { name: commit.branch, createdAt: commit.commitedAt },
            true
          ).then(result => result.id);
          branchIds.set(commit.branch, branchId);
        }
        await this.upsertCommit(client, {
          sha: commit.commitSha,
          parentSha: commit.parentCommitSha,
          branchId,
          author: commit.authorName,
          message: commit.message,
          committedAt: commit.commitedAt,
        });
        commitsSaved += 1;
      }

      for (const merge of payload.merges || []) {
        const sourceBranchId = await this.getOrCreateBranchId(
          client, repositoryId, branchIds, merge.sourceBranch, merge.mergedAt
        );
        const targetBranchId = await this.getOrCreateBranchId(
          client, repositoryId, branchIds, merge.targetBranch, merge.mergedAt
        );
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtext($1))',
          [`merge:${sourceBranchId}:${targetBranchId}:${merge.mergeCommitSha}`]
        );
        const duplicate = await client.query(
          `SELECT id FROM public.tdd_merge
           WHERE source_branch_id = $1 AND target_branch_id = $2
             AND source_commit_sha = $3 AND merge_commit_sha = $4
           LIMIT 1`,
          [sourceBranchId, targetBranchId, merge.sourceCommitSha, merge.mergeCommitSha]
        );
        if (duplicate.rows.length) {
          continue;
        }

        await client.query(
          `INSERT INTO public.tdd_merge
            (source_branch_id, target_branch_id, source_commit_sha,
             merge_commit_sha, is_fast_forward, merged_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            sourceBranchId,
            targetBranchId,
            merge.sourceCommitSha,
            merge.mergeCommitSha,
            merge.isFastForward ? 1 : 0,
            dateOnly(merge.mergedAt),
          ]
        );
        mergesSaved += 1;
      }

      return {
        repository: payload.repository,
        branchesSaved,
        commitsSaved,
        mergesSaved,
        executionsSaved: 0,
      };
    });
  }

  async upsertRepository(client, repository) {
    const { owner, repoName, repoUrl } = repositoryParts(repository);
    const result = await client.query(
      `INSERT INTO public.tdd_repository (repos_name, repo_url, owner)
       VALUES ($1, $2, $3)
       ON CONFLICT (repo_url) DO UPDATE SET
         repos_name = EXCLUDED.repos_name,
         owner = EXCLUDED.owner
       RETURNING id`,
      [repoName, repoUrl, owner]
    );
    return result.rows[0].id;
  }

  async upsertBranch(client, repositoryId, branch, withStatus = false) {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [`${repositoryId}:${branch.name}`]
    );
    const existing = await client.query(
      `SELECT id FROM public.tdd_branch
       WHERE repo_id = $1 AND name = $2
       ORDER BY created_at ASC NULLS LAST
       LIMIT 1`,
      [repositoryId, branch.name]
    );
    if (existing.rows.length) {
      await client.query(
        `UPDATE public.tdd_branch
         SET fork_commit_sha = COALESCE(fork_commit_sha, $2)
         WHERE id = $1`,
        [existing.rows[0].id, branch.forkCommitSha || null]
      );
      return withStatus
        ? { id: existing.rows[0].id, inserted: false }
        : existing.rows[0].id;
    }
    const inserted = await client.query(
      `INSERT INTO public.tdd_branch (name, fork_commit_sha, created_at, repo_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [
        branch.name,
        branch.forkCommitSha || null,
        dateOnly(branch.createdAt),
        repositoryId,
      ]
    );
    return withStatus
      ? { id: inserted.rows[0].id, inserted: true }
      : inserted.rows[0].id;
  }

  async getOrCreateBranchId(client, repositoryId, branchIds, name, createdAt) {
    if (!branchIds.has(name)) {
      const branch = await this.upsertBranch(client, repositoryId, { name, createdAt }, true);
      branchIds.set(name, branch.id);
    }
    return branchIds.get(name);
  }

  async upsertCommit(client, commit) {
    await client.query(
      `INSERT INTO public.tdd_commit AS existing
        (sha, parent_sha, branch_id, author, message, committed_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (sha) DO UPDATE SET
         parent_sha = COALESCE(EXCLUDED.parent_sha, existing.parent_sha),
         branch_id = COALESCE(EXCLUDED.branch_id, existing.branch_id),
         author = COALESCE(EXCLUDED.author, existing.author),
         message = COALESCE(EXCLUDED.message, existing.message),
         committed_at = COALESCE(EXCLUDED.committed_at, existing.committed_at)`,
      [
        commit.sha,
        commit.parentSha || null,
        commit.branchId || null,
        commit.author || null,
        commit.message || null,
        commit.committedAt || null,
      ]
    );
  }
}

export default NeonActivityStore;
