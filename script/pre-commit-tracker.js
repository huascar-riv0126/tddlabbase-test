import { LocalTddStore } from './localTddStore.js';
import { captureGitContext } from './gitContext.js';

export async function trackPreCommit(store = new LocalTddStore()) {
  try {
    await store.initialize();
    const ctx = captureGitContext();
    if (!ctx.inGitRepo) {
      await store.close();
      return { skipped: true, reason: 'not a git repo' };
    }
    if (ctx.branchName) {
      await store.upsertBranch({
        name: ctx.branchName,
        forkCommitSha: ctx.headSha || null
      });
    }
    // Registrar contexto de commit en preparación (HEAD actual como referencia)
    if (ctx.headSha) {
      // No alteramos commits existentes; solo aseguramos que la rama esté registrada
    }
    await store.close();
    return { ok: true, branch: ctx.branchName || null };
  } catch (error) {
    try { await store.close(); } catch {}
    throw error;
  }
}

async function main() {
  if (process.env.HUSKY_SKIP_TRACK === '1') {process.exit(0);}
  try {
    await trackPreCommit();
    process.exit(0);
  } catch (error) {
    console.error('[pre-commit] Error registrando en BD local:', error.message);
    // No bloquear commit por fallos de tracking local salvo que se desee estricto
    process.exit(0);
  }
}

if (process.argv[1] && process.argv[1].endsWith('pre-commit-tracker.js')) {
  main();
}

export { LocalTddStore };
