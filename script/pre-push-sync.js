import 'dotenv/config';
import fs from 'fs';
import LocalTddStore from './localTddStore.js';
import { syncLocalToRemote, redactError } from './sync-to-remote.js';

async function readStdin() {
  try {
    if (process.stdin.isTTY) return '';
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

async function main() {
  if (process.env.HUSKY_SKIP_TRACK === '1' || process.env.SKIP_DB_SYNC === '1') {
    process.exit(0);
  }
  let localStore = null;
  try {
    const stdinText = await readStdin();
    localStore = new LocalTddStore();
    await localStore.initialize();
    const result = await syncLocalToRemote({ localStore, stdinText });
    const commits = result.payload?.commits?.length || 0;
    const execs = result.payload?.executions?.length || 0;
    const merges = result.payload?.merges?.length || 0;
    if (result.skipped) {
      console.log(`[pre-push-sync] Sin datos nuevos para sincronizar (${result.reason || 'omitido'}).`);
    } else {
      console.log(`[pre-push-sync] Sincronizado a BD remota: commits=${commits}, ejecuciones=${execs}, merges=${merges}.`);
    }
    await localStore.close();
    process.exit(0);
  } catch (error) {
    console.error('[pre-push-sync] Error al sincronizar con la BD remota:', redactError(error));
    console.error('[pre-push-sync] Push abortado para evitar pérdida de trazabilidad. Configura DATABASE_URL o usa SKIP_DB_SYNC=1 bajo tu responsabilidad.');
    try { if (localStore) await localStore.close(); } catch {}
    process.exit(1);
  }
}

main();
