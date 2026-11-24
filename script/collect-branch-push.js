import { execFileSync } from 'node:child_process';
import { getCurrentBranch, getRemoteUrl } from './gitContext.js';
import { collectSyncPayload, computePushCommitShas, readPrePushRefsFromStdin } from './sync-to-remote.js';
import { branchForApi, commitsForApi, mergesForApi, repositoryFromRemote } from './branch-push-payload.js';

export async function collectBranchPush(localStore, stdinText, remote = 'origin', cwd = process.cwd()) {
  const updates = readPrePushRefsFromStdin(stdinText)
    .filter(ref => ref.remoteRef.startsWith('refs/heads/') && !/^0+$/.test(ref.localSha));
  if (!updates.length) {
    return null;
  }

  const branchesBySha = new Map();
  for (const ref of updates) {
    const name = ref.remoteRef.slice('refs/heads/'.length);
    for (const sha of computePushCommitShas([ref], cwd, remote)) {
      if (!branchesBySha.has(sha)) {
        branchesBySha.set(sha, name);
      }
    }
  }

  return buildBranchPush(localStore, remote, cwd, updates, branchesBySha);
}

export async function collectCommitPush(localStore, revision, cwd = process.cwd()) {
  if (!/^[0-9a-f]{4,64}$/i.test(revision || '')) {
    throw new Error('Indica el SHA del commit, por ejemplo: npm run db:sync -- --commit 0557321');
  }
  const branch = getCurrentBranch({ cwd });
  if (!branch) {throw new Error('Selecciona la rama que contiene el commit.');}
  let sha;
  try {
    const options = { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
    sha = execFileSync('git', ['rev-parse', '--verify', revision + '^{commit}'], options).trim();
    execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], options);
  } catch {
    throw new Error('Verifica que el SHA identifica un commit de la rama activa.');
  }
  const update = { remoteRef: 'refs/heads/' + branch, localSha: sha };
  return buildBranchPush(localStore, 'origin', cwd, [update], new Map([[sha, branch]]));
}

async function buildBranchPush(localStore, remote, cwd, updates, branchesBySha) {
  const repository = repositoryFromRemote(getRemoteUrl({ remote, cwd }) || remote);
  const rows = await collectSyncPayload(localStore, [...branchesBySha.keys()]);
  const merges = mergesForApi(repository.slug, rows.merges, branchesBySha);
  // Un merge puede integrar un SHA ya publicado en Git pero ausente de la API.
  const sources = new Map();
  for (const merge of merges) {
    if (!branchesBySha.has(merge.sourceCommitSha)) {
      sources.set(merge.sourceCommitSha, merge.sourceBranch);
    }
  }
  if (sources.size) {
    const shas = [...sources.keys()];
    rows.commits.push(...await localStore.getCommitsByShas(shas));
    rows.executions.push(...await localStore.getExecutionsByCommitShas(shas));
    for (const [sha, branch] of sources) {branchesBySha.set(sha, branch);}
  }
  const commits = commitsForApi(repository.slug, rows, branchesBySha, cwd);
  const observed = new Map();
  function observe(name, date) {
    if (!observed.has(name) || date < observed.get(name)) {
      observed.set(name, date);
    }
  }
  for (const commit of commits) {
    observe(commit.branch, commit.commitedAt);
  }
  for (const merge of merges) {
    observe(merge.sourceBranch, merge.mergedAt);
    observe(merge.targetBranch, merge.mergedAt);
  }
  const datesBySha = new Map(commits.map(c => [c.commitSha, c.commitedAt]));
  for (const ref of updates) {
    observe(ref.remoteRef.slice('refs/heads/'.length), datesBySha.get(ref.localSha));
  }

  const branches = [];
  const stored = new Map(rows.branches.map(row => [row.name, row]));
  for (const [name, date] of observed) {
    const row = stored.get(name) || await localStore.getBranch(name) || { name };
    branches.push(branchForApi(repository.slug, row, date, cwd));
  }
  return { repository, branches, commits, merges };
}
