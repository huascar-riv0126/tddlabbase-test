import { LocalTddStore } from './localTddStore.js';
import { TddStore as RemoteTddStore } from './tddStore.js';
import { captureGitContext, getCommitDate } from './gitContext.js';
import { execFileSync } from 'child_process';

function runGit(args, cwd = process.cwd()) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

export function detectMergeInfo({ cwd = process.cwd() } = {}) {
  const ctx = captureGitContext({ cwd });
  const parents = ctx.parents || [];
  const head = ctx.headSha;
  const targetBranch = ctx.branchName || null;
  if (!head) {return null;}

  if (parents.length >= 2) {
    const sourceCommitSha = parents[1];
    let sourceBranch = null;
    const reflog = runGit(['reflog', '-1', '--format=%gs'], cwd);
    if (reflog) {
      const m = reflog.match(/^merge\s+(.+?)(?::|$)/i);
      if (m && m[1]) {sourceBranch = m[1].trim().replace(/^origin\//, '');}
    }
    if (!sourceBranch) {
      const branchesOut = runGit(['branch', '--contains', sourceCommitSha, '--format=%(refname:short)'], cwd) || '';
      const candidates = branchesOut.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      sourceBranch = candidates.find((b) => b !== targetBranch) || candidates[0] || targetBranch || 'unknown';
    }
    return {
      sourceBranch,
      targetBranch: targetBranch || 'HEAD',
      sourceCommitSha,
      mergeCommitSha: head,
      isFastForward: false,
      mergedAt: getCommitDate({ sha: head, cwd }) || undefined
    };
  }

  const origHead = runGit(['rev-parse', '--verify', '--quiet', 'ORIG_HEAD'], cwd);
  const reflog = runGit(['reflog', '-1', '--format=%gs'], cwd) || '';
  const isMergeAction = /^(merge|pull)\b/i.test(reflog) || !!origHead;
  if (isMergeAction && origHead && origHead !== head) {
    let sourceBranch = null;
    const m = reflog.match(/^(?:merge|pull)\s+(.+?)(?::|$)/i);
    if (m && m[1]) {sourceBranch = m[1].trim().replace(/^origin\//, '');}
    if (!sourceBranch) {
      const branchesOut = runGit(['branch', '--contains', head, '--format=%(refname:short)'], cwd) || '';
      const candidates = branchesOut.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      sourceBranch = candidates.find((b) => b !== targetBranch) || candidates[0] || 'unknown';
    }
    return {
      sourceBranch,
      targetBranch: targetBranch || 'HEAD',
      sourceCommitSha: head,
      mergeCommitSha: head,
      isFastForward: true,
      mergedAt: getCommitDate({ sha: head, cwd }) || undefined
    };
  }

  return null;
}

// Compatibility helper for existing tests
export function getMergeSourceBranch({ sourceCommitSha, targetBranch, cwd = process.cwd() }) {
  const reflog = runGit(['reflog', '-1', '--format=%gs'], cwd);
  if (reflog) {
    const match = reflog.match(/^merge\s+(.+?)(?::|$)/i);
    if (match && match[1]) {return match[1].trim().replace(/^origin\//, '');}
  }
  const branchesOut = runGit(['branch', '--contains', sourceCommitSha, '--format=%(refname:short)'], cwd) || '';
  const branches = branchesOut.split(/\r?\n/).map((b) => b.trim()).filter((b) => b && b !== targetBranch);
  return branches[0] || targetBranch;
}

export function getSourceBranch(args) { return getMergeSourceBranch(args); }

export async function recordMergeEvent(store = null, { cwd = process.cwd() } = {}) {
  const own = !store;
  const s = store || new LocalTddStore();
  try {
    await s.initialize();
    const info = detectMergeInfo({ cwd });
    if (!info) {
      if (own) {await s.close();}
      return { skipped: true };
    }
    const ctx = captureGitContext({ cwd });
    const existingTip = info.isFastForward && ctx.headSha && await s.getCommit(ctx.headSha);
    if (ctx.headSha && !existingTip) {
      await s.upsertCommit({
        sha: ctx.headSha,
        parentSha: (ctx.parents && ctx.parents[0]) || null,
        branch: info.isFastForward ? info.sourceBranch : ctx.branchName || null,
        author: null,
        message: ctx.commitMessage || null,
        committedAt: getCommitDate({ sha: ctx.headSha, cwd }) || null
      });
    }
    if (info.targetBranch && info.targetBranch !== 'HEAD') {
      await s.upsertBranch({ name: info.targetBranch, forkCommitSha: info.mergeCommitSha });
    }
    if (info.sourceBranch && info.sourceBranch !== 'unknown') {
      await s.upsertBranch({ name: info.sourceBranch, forkCommitSha: info.sourceCommitSha });
    }
    await s.recordMerge(info);
    if (own) {await s.close();}
    return { ok: true, merge: info };
  } catch (error) {
    try { if (own) {await s.close();} } catch {}
    throw error;
  }
}

async function main(store = null) {
  if (process.env.HUSKY_SKIP_TRACK === '1') {process.exit(0);}
  try {
    await recordMergeEvent(store);
    process.exit(0);
  } catch (error) {
    console.error('[merge-tracker] Error registrando merge:', error.message);
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('merge-tracker.js')) {
  main().catch((error) => {
    console.error('[merge-tracker] Error registrando merge:', error.message);
    process.exit(1);
  });
}

export { RemoteTddStore as TDDLogBDAdapter, main };

