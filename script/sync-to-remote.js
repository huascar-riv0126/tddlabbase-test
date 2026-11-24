import { execFileSync } from 'child_process';

function runGit(args, cwd = process.cwd()) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

export function readPrePushRefsFromStdin(stdinText = '') {
  const lines = String(stdinText || '').trim().split(/\r?\n/).filter(Boolean);
  return lines.map((line) => {
    const [localRef, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/);
    return { localRef, localSha, remoteRef, remoteSha };
  }).filter((r) => r.localRef && r.localSha && r.remoteRef && r.remoteSha);
}

function isZeroSha(sha) { return /^0+$/.test(sha || ''); }

export function getCommitsInRange(rangeSpec, cwd = process.cwd(), extraArgs = []) {
  if (!rangeSpec) {return [];}
  const out = runGit(['rev-list', '--reverse', rangeSpec, ...extraArgs], cwd);
  if (!out) {return [];}
  return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

export function computePushCommitShas(refUpdates, cwd = process.cwd(), remoteName = 'origin') {
  const shas = new Set();
  for (const ref of refUpdates) {
    const { localSha, remoteSha } = ref;
    if (isZeroSha(localSha)) {continue;} // delete
    const newBranch = isZeroSha(remoteSha);
    const range = newBranch ? localSha : `${remoteSha}..${localSha}`;
    const excludePublished = newBranch ? ['--not', `--remotes=${remoteName}`] : [];
    const listed = getCommitsInRange(range, cwd, excludePublished);
    if (listed.length) {listed.forEach((s) => shas.add(s));}
    else if (!isZeroSha(localSha)) {shas.add(localSha);} // fast-forward/direct
  }
  return Array.from(shas);
}

export async function collectSyncPayload(localStore, commitShas, { branchName = null } = {}) {
  await localStore.initialize();
  const commits = commitShas && commitShas.length
    ? await localStore.getCommitsByShas(commitShas)
    : (branchName ? await localStore.getCommitsByBranch(branchName) : await localStore.getAllCommits());
  const shaSet = new Set((commits || []).map((c) => c.sha));
  if (commitShas) {commitShas.forEach((s) => shaSet.add(s));}
  const shas = Array.from(shaSet);
  const executions = shas.length ? await localStore.getExecutionsByCommitShas(shas) : [];
  const merges = shas.length ? await localStore.getMergesByCommitShas(shas) : [];
  const branches = new Set();
  for (const c of commits || []) {if (c.branch) {branches.add(c.branch);}}
  for (const m of merges || []) { if (m.source_branch) {branches.add(m.source_branch);} if (m.target_branch) {branches.add(m.target_branch);} }
  if (branchName) {branches.add(branchName);}
  const branchRows = [];
  for (const name of branches) {
    const b = await localStore.getBranch(name);
    if (b) {branchRows.push(b);}
    else {branchRows.push({ name, fork_commit_sha: null });}
  }
  return { branches: branchRows, commits: commits || [], merges: merges || [], executions: executions || [] };
}
