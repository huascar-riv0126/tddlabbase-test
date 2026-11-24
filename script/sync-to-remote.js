import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import LocalTddStore from './localTddStore.js';
import { TddStore as RemoteTddStore } from './tddStore.js';
import { ensureSafeRemoteUrl, redactError } from './db-security.js';

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

export function getCommitsInRange(rangeSpec, cwd = process.cwd()) {
  if (!rangeSpec) return [];
  const out = runGit(['rev-list', '--reverse', rangeSpec], cwd);
  if (!out) return [];
  return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

export function computePushCommitShas(refUpdates, cwd = process.cwd()) {
  const shas = new Set();
  for (const ref of refUpdates) {
    const { localSha, remoteSha } = ref;
    if (isZeroSha(localSha)) continue; // delete
    let range = null;
    if (isZeroSha(remoteSha)) {
      const remoteRef = ref.remoteRef;
      const remoteExists = runGit(['rev-parse', '--verify', '--quiet', remoteRef], cwd);
      if (remoteExists) {
        range = `${remoteRef}..${localSha}`;
      } else {
        range = localSha; // new branch with unknown base; best-effort include reachable
      }
    } else {
      range = `${remoteSha}..${localSha}`;
    }
    const listed = getCommitsInRange(range, cwd);
    if (listed.length) listed.forEach((s) => shas.add(s));
    else if (!isZeroSha(localSha)) shas.add(localSha); // fast-forward/direct
  }
  return Array.from(shas);
}

export async function collectSyncPayload(localStore, commitShas, { branchName = null } = {}) {
  await localStore.initialize();
  const commits = commitShas && commitShas.length
    ? await localStore.getCommitsByShas(commitShas)
    : (branchName ? await localStore.getCommitsByBranch(branchName) : await localStore.getAllCommits());
  const shaSet = new Set((commits || []).map((c) => c.sha));
  if (commitShas) commitShas.forEach((s) => shaSet.add(s));
  const shas = Array.from(shaSet);
  const executions = shas.length ? await localStore.getExecutionsByCommitShas(shas) : [];
  const merges = shas.length ? await localStore.getMergesByCommitShas(shas) : [];
  const branches = new Set();
  for (const c of commits || []) if (c.branch) branches.add(c.branch);
  for (const m of merges || []) { if (m.source_branch) branches.add(m.source_branch); if (m.target_branch) branches.add(m.target_branch); }
  if (branchName) branches.add(branchName);
  const branchRows = [];
  for (const name of branches) {
    const b = await localStore.getBranch(name);
    if (b) branchRows.push(b);
    else branchRows.push({ name, fork_commit_sha: null });
  }
  return { branches: branchRows, commits: commits || [], merges: merges || [], executions: executions || [] };
}

export async function syncPayloadToRemote(remoteStore, payload) {
  await remoteStore.initialize();
  for (const b of payload.branches || []) {
    await remoteStore.upsertBranch({ name: b.name, forkCommitSha: b.fork_commit_sha || b.forkCommitSha || null });
  }
  for (const c of payload.commits || []) {
    await remoteStore.upsertCommit({
      sha: c.sha,
      parentSha: c.parent_sha || c.parentSha || null,
      branch: c.branch || null,
      author: c.author || null,
      message: c.message || null,
      committedAt: c.committed_at || c.committedAt || null
    });
  }
  for (const m of payload.merges || []) {
    // avoid duplicates best-effort by checking existing merges
    const existing = await remoteStore.getMerges();
    const dup = (existing || []).some((x) =>
      x.merge_commit_sha === (m.merge_commit_sha || m.mergeCommitSha) &&
      x.source_branch === (m.source_branch || m.sourceBranch) &&
      x.target_branch === (m.target_branch || m.targetBranch)
    );
    if (!dup) {
      await remoteStore.recordMerge({
        sourceBranch: m.source_branch || m.sourceBranch,
        targetBranch: m.target_branch || m.targetBranch,
        sourceCommitSha: m.source_commit_sha || m.sourceCommitSha,
        mergeCommitSha: m.merge_commit_sha || m.mergeCommitSha,
        isFastForward: !!(m.is_fast_forward ?? m.isFastForward),
        mergedAt: m.merged_at || m.mergedAt || undefined
      });
    }
  }
  // executions: insert if not already present for same commit+executed_at+counts (best-effort idempotency)
  const existingExecs = await remoteStore.getExecutionsByBranch();
  const execKey = (e) => [e.commit_sha || e.commitSha || '', e.executed_at || e.executedAt || '', e.tests_total ?? e.testsTotal ?? 0, e.tests_passed ?? e.testsPassed ?? 0, e.tests_failed ?? e.testsFailed ?? 0].join('|');
  const existingKeys = new Set((existingExecs || []).map(execKey));
  for (const e of payload.executions || []) {
    if (existingKeys.has(execKey(e))) continue;
    await remoteStore.insertExecution({
      commitSha: e.commit_sha || e.commitSha || null,
      testsTotal: e.tests_total ?? e.testsTotal ?? 0,
      testsPassed: e.tests_passed ?? e.testsPassed ?? 0,
      testsFailed: e.tests_failed ?? e.testsFailed ?? 0,
      executedAt: e.executed_at || e.executedAt || undefined
    });
  }
}

export async function syncLocalToRemote({ localStore = null, remoteStore = null, stdinText = '', branchName = null } = {}) {
  const ownLocal = !localStore;
  const ownRemote = !remoteStore;
  const local = localStore || new LocalTddStore();
  try {
    await local.initialize();
    const refs = readPrePushRefsFromStdin(stdinText);
    const commitShas = refs.length ? computePushCommitShas(refs) : [];
    const payload = await collectSyncPayload(local, commitShas, { branchName: branchName || runGit(['rev-parse', '--abbrev-ref', 'HEAD']) });
    if (!commitShas.length && refs.length) {
      // deleting refs only
      return { synced: 0, payload, skipped: true, reason: 'no commits to sync' };
    }
    const url = process.env.DATABASE_URL;
    ensureSafeRemoteUrl(url);
    const remote = remoteStore || new RemoteTddStore();
    try {
      await syncPayloadToRemote(remote, payload);
      return { synced: (payload.commits?.length || 0) + (payload.executions?.length || 0) + (payload.merges?.length || 0), payload };
    } finally {
      if (ownRemote) await remote.close();
    }
  } finally {
    if (ownLocal) await local.close();
  }
}

export { redactError };
