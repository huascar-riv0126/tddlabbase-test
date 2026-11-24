import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tdd_schema_migration (
  version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS tdd_branch (
  name TEXT PRIMARY KEY,
  fork_commit_sha TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tdd_commit (
  sha TEXT PRIMARY KEY,
  parent_sha TEXT,
  branch TEXT,
  author TEXT,
  message TEXT,
  committed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS tdd_merge (
  id SERIAL PRIMARY KEY,
  source_branch TEXT NOT NULL,
  target_branch TEXT NOT NULL,
  source_commit_sha TEXT NOT NULL,
  merge_commit_sha TEXT NOT NULL,
  is_fast_forward INTEGER NOT NULL DEFAULT 0,
  merged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tdd_execution (
  id SERIAL PRIMARY KEY,
  commit_sha TEXT,
  tests_total INTEGER DEFAULT 0,
  tests_passed INTEGER DEFAULT 0,
  tests_failed INTEGER DEFAULT 0,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tdd_execution_commit_sha ON tdd_execution(commit_sha);
CREATE INDEX IF NOT EXISTS idx_tdd_execution_executed_at ON tdd_execution(executed_at);
`;

function nowIso() {
  return new Date().toISOString();
}

export class TddStore {
  constructor({ pool } = {}) {
    if (!pool && !process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL no está configurada');
    }
    this.pool = pool || new Pool({ connectionString: process.env.DATABASE_URL });
    this.db = this.pool;
    this._initialized = false;
    this._initializing = null;
    this._closed = false;
  }

  async initialize() {
    if (this._initialized) {
      return this.db;
    }
    if (!this._initializing) {
      this._initializing = (async () => {
        await this.pool.query(SCHEMA);
        await this.pool.query(
          `INSERT INTO tdd_schema_migration (version)
           VALUES ($1)
           ON CONFLICT (version) DO NOTHING`,
          [SCHEMA_VERSION]
        );
        this._initialized = true;
        return this.db;
      })();
    }
    await this._initializing;
    return this.db;
  }

  async close() {
    if (this.pool && !this._closed) {
      await this.pool.end();
      this._closed = true;
      this._initialized = false;
      this._initializing = null;
    }
  }

  async withTransaction(callback) {
    await this.initialize();
    if (!this.pool || typeof this.pool.connect !== 'function') {
      throw new Error('El pool no soporta transacciones');
    }

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

  async upsertBranch({ name, forkCommitSha }) {
    await this.initialize();
    await this.pool.query(
      `INSERT INTO tdd_branch (name, fork_commit_sha)
       VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET fork_commit_sha = EXCLUDED.fork_commit_sha`,
      [name, forkCommitSha || null]
    );
    return name;
  }

  async upsertCommit({ sha, parentSha, branch, author, message, committedAt }) {
    await this.initialize();
    await this.pool.query(
      `INSERT INTO tdd_commit
        (sha, parent_sha, branch, author, message, committed_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (sha) DO UPDATE SET
         parent_sha = EXCLUDED.parent_sha,
         branch = EXCLUDED.branch,
         author = EXCLUDED.author,
         message = EXCLUDED.message,
         committed_at = EXCLUDED.committed_at`,
      [sha, parentSha || null, branch || null, author || null, message || null, committedAt || null]
    );
    return sha;
  }

  async recordMerge({ sourceBranch, targetBranch, sourceCommitSha, mergeCommitSha, isFastForward, mergedAt }) {
    await this.initialize();
    await this.pool.query(
      `INSERT INTO tdd_merge
        (source_branch, target_branch, source_commit_sha, merge_commit_sha, is_fast_forward, merged_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [sourceBranch, targetBranch, sourceCommitSha, mergeCommitSha, isFastForward ? 1 : 0, mergedAt || nowIso()]
    );
  }

  async insertExecution({ commitSha, testsTotal, testsPassed, testsFailed, executedAt }) {
    await this.initialize();
    const result = await this.pool.query(
      `INSERT INTO tdd_execution
        (commit_sha, tests_total, tests_passed, tests_failed, executed_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [commitSha || null, testsTotal || 0, testsPassed || 0, testsFailed || 0, executedAt || nowIso()]
    );
    return result.rows[0].id;
  }

  async getExecutionById(id) {
    await this.initialize();
    const result = await this.pool.query('SELECT * FROM tdd_execution WHERE id = $1', [id]);
    return result.rows[0];
  }

  async getExecutionsByCommit(commitSha) {
    await this.initialize();
    const result = await this.pool.query(
      'SELECT * FROM tdd_execution WHERE commit_sha = $1 ORDER BY executed_at DESC',
      [commitSha]
    );
    return result.rows;
  }

  async getExecutionsByBranch() {
    await this.initialize();
    const result = await this.pool.query('SELECT * FROM tdd_execution ORDER BY executed_at DESC');
    return result.rows;
  }

  async getCommit(sha) {
    await this.initialize();
    const result = await this.pool.query('SELECT * FROM tdd_commit WHERE sha = $1', [sha]);
    return result.rows[0];
  }

  async getBranch(name) {
    await this.initialize();
    const result = await this.pool.query('SELECT * FROM tdd_branch WHERE name = $1', [name]);
    return result.rows[0];
  }

  async getMerges() {
    await this.initialize();
    const result = await this.pool.query('SELECT * FROM tdd_merge ORDER BY merged_at DESC');
    return result.rows;
  }

  async countExecutions() {
    await this.initialize();
    const result = await this.pool.query('SELECT COUNT(*)::integer AS c FROM tdd_execution');
    return result.rows[0].c;
  }

  async countCommits() {
    await this.initialize();
    const result = await this.pool.query('SELECT COUNT(*)::integer AS c FROM tdd_commit');
    return result.rows[0].c;
  }
}

export { nowIso, SCHEMA_VERSION };
export default TddStore;
