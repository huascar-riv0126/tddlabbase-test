import 'dotenv/config';
import fs from 'fs';
import LocalTddStore from './localTddStore.js';
import { collectBranchPush, collectCommitPush } from './collect-branch-push.js';
import { redactError } from './db-security.js';
import { postBranchActivity } from './branch-api.js';
import { getCurrentBranch, getHeadSha } from './gitContext.js';

function currentBranchUpdate() {
  const branch = getCurrentBranch();
  if (!branch) {
    throw new Error('Selecciona una rama antes de enviar su actividad.');
  }
  const sha = getHeadSha();
  const ref = `refs/heads/${branch}`;
  return `${ref} ${sha} ${ref} ${'0'.repeat(sha.length)}`;
}

async function main() {
  if (process.env.HUSKY_SKIP_TRACK === '1' || process.env.SKIP_DB_SYNC === '1') {
    process.exit(0);
  }
  const localStore = new LocalTddStore();
  const remote = process.argv[2];
  try {
    let body;
    if (remote === '--commit') {
      body = await collectCommitPush(localStore, process.argv[3]);
    } else {
      let refs = process.stdin.isTTY ? '' : fs.readFileSync(0, 'utf8');
      if (!remote && !refs.trim()) refs = currentBranchUpdate();
      body = await collectBranchPush(localStore, refs, remote || 'origin');
    }
    if (body) {
      const saved = await postBranchActivity(body);
      console.log(`[pre-push] API: ${saved.branchesSaved} ramas, ${saved.commitsSaved} commits, ${saved.mergesSaved} merges y ${saved.executionsSaved} ejecuciones.`);
    }
  } catch (error) {
    console.error('[pre-push] Sincronización pendiente:', redactError(error));
    console.error('[pre-push] Revisa la conexión y repite el push. Los datos siguen en SQLite.');
    process.exitCode = 1;
  } finally {
    await localStore.close();
  }
}

main();
