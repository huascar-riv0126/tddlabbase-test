import { execFileSync } from 'child_process';
import { TDDLogBDAdapter } from './TDDLogBDAdapter.js';
import {
  captureGitContext,
  getCommitDate
} from './gitContext.js';

function getSourceBranch({ sourceCommitSha, targetBranch, cwd = process.cwd() }) {
  const output = execFileSync(
    'git',
    ['branch', '--contains', sourceCommitSha, '--format=%(refname:short)'],
    { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const branches = output
    .trim()
    .split(/\r?\n/)
    .map((branch) => branch.trim())
    .filter((branch) => branch && branch !== targetBranch);

  return branches[0] || targetBranch;
}

function getMergeSourceBranch({ sourceCommitSha, targetBranch, cwd }) {
  try {
    const reflog = execFileSync(
      'git',
      ['reflog', '-1', '--format=%gs'],
      { cwd, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim();
    const match = reflog.match(/^merge (.+?)(?::|$)/i);
    if (match && match[1]) {
      return match[1].trim();
    }
  } catch {
    // Fall back to the branch that contains the source commit.
  }

  return getSourceBranch({ sourceCommitSha, targetBranch, cwd });
}

async function main(store = new TDDLogBDAdapter()) {
  try {
    await store.initialize();
    const context = captureGitContext();
    const parents = context.parents || [];

    if (!context.branchName || !context.headSha) {
      await store.close();
      process.exit(0);
    }

    const isFastForward = parents.length < 2;
    const sourceCommitSha = isFastForward ? context.headSha : parents[1];
    const sourceBranch = getMergeSourceBranch({
      sourceCommitSha,
      targetBranch: context.branchName,
      cwd: context.repoRoot || process.cwd()
    });

    await store.recordMerge({
      sourceBranch,
      targetBranch: context.branchName,
      sourceCommitSha,
      mergeCommitSha: context.headSha,
      isFastForward,
      mergedAt: getCommitDate({
        sha: context.headSha,
        cwd: context.repoRoot || process.cwd()
      }) || undefined
    });

    await store.close();
    process.exit(0);
  } catch (error) {
    console.error('Error en merge-tracker.js:', error.message);
    try {
      await store.close();
    } catch (closeError) {
      console.error('Error al cerrar merge-tracker.js:', closeError.message);
    }
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
  main().catch((error) => {
    console.error('Error en merge-tracker.js:', error.message);
    process.exit(1);
  });
}

export { TDDLogBDAdapter, getMergeSourceBranch, getSourceBranch, main };
