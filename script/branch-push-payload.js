import { execFileSync } from 'node:child_process';
import { getCommitAuthor, getCommitDate, getCommitMessage, getCommitParents } from './gitContext.js';

export function repositoryFromRemote(remoteUrl) {
  const url = new URL((remoteUrl || '').replace(/^git@([^:]+):(.+)$/, 'ssh://git@$1/$2'));
  const slug = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
  if (!['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol) || !slug.includes('/')) {
    throw new Error('Se necesita la URL del repositorio con su propietario y nombre.');
  }
  const host = url.protocol === 'ssh:' || url.protocol === 'git:' ? `https://${url.hostname}` : url.origin;
  return { slug, remoteUrl: `${host}/${slug}` };
}

function isoDate(value) {
  // SQLite usa UTC cuando escribe datetime('now') sin zona horaria.
  const timestamp = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value) ? value.replace(' ', 'T') + 'Z' : value;
  return new Date(timestamp).toISOString();
}

export function branchForApi(slug, row, observedAt, cwd) {
  // Un checkout puede actualizar fork_commit_sha en las bases antiguas.
  // El reflog conserva el SHA original mientras exista la entrada de creación.
  let creation;
  try {
    const log = execFileSync('git', [
      'reflog', 'show', '--date=unix', '--format=%gD%x00%H%x00%gs', `refs/heads/${row.name}`,
    ], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    creation = log.trimEnd().split('\n').at(-1)?.match(/@\{(\d+)\}\0([0-9a-f]+)\0branch: Created from /);
  } catch {
    // Una rama ya borrada todavía puede estar registrada en SQLite.
  }
  return {
    repositorySlug: slug, name: row.name,
    createdAt: creation ? new Date(Number(creation[1]) * 1000).toISOString() : isoDate(row.created_at || observedAt),
    ...(creation && { forkCommitSha: creation[2] }),
  };
}

export function commitsForApi(repositorySlug, rows, branchesBySha, cwd) {
  const executions = new Map();
  for (const run of rows.executions) {
    if (!executions.has(run.commit_sha)) {
      executions.set(run.commit_sha, []);
    }
    executions.get(run.commit_sha).push({
      testsTotal: run.tests_total, testsPassed: run.tests_passed, testsFailed: run.tests_failed,
      executedAt: isoDate(run.executed_at),
    });
  }
  const stored = new Map(rows.commits.map(row => [row.sha, row]));
  return Array.from(branchesBySha, ([sha, pushedBranch]) => {
    const row = stored.get(sha);
    const git = { sha, cwd };
    const parent = row?.parent_sha ?? getCommitParents(git)[0];
    return {
      repositorySlug, commitSha: sha, ...(parent && { parentCommitSha: parent }),
      branch: row?.branch || pushedBranch,
      authorName: row?.author ?? getCommitAuthor(git),
      message: row?.message ?? getCommitMessage(git),
      commitedAt: isoDate(row?.committed_at || getCommitDate(git)),
      tddExecutions: executions.get(sha) || [],
    };
  });
}

export function mergesForApi(repositorySlug, rows, branchesBySha) {
  // SQLite también devuelve merges en los que solo el padre está en el rango.
  return rows.filter(row => branchesBySha.has(row.merge_commit_sha)).map(row => ({
    repositorySlug, sourceBranch: row.source_branch, targetBranch: row.target_branch,
    sourceCommitSha: row.source_commit_sha, mergeCommitSha: row.merge_commit_sha,
    isFastForward: Boolean(row.is_fast_forward), mergedAt: isoDate(row.merged_at),
  }));
}
