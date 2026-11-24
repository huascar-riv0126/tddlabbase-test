import 'dotenv/config';
import LocalTddStore from './localTddStore.js';
import NeonActivityStore from './neonActivityStore.js';
import { redactError } from './db-security.js';

export async function initializeSchema({ local = true, remote = false, dbPath = null } = {}) {
  let localStore = null;
  let remoteStore = null;
  try {
    if (local) {
      localStore = new LocalTddStore({ dbPath });
      await localStore.initialize();
      console.log(`[init-db] Esquema SQLite inicializado en: ${localStore.dbPath}`);
    }
    if (remote) {
      remoteStore = new NeonActivityStore();
      await remoteStore.initialize();
      console.log('[init-db] Esquema Neon validado correctamente.');
    }
    return { ok: true };
  } finally {
    if (localStore) {
      await localStore.close();
    }
    if (remoteStore) {
      await remoteStore.close();
    }
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const remote = args.has('--remote') || args.has('--all');
  const local = args.has('--local') || args.has('--all') || (!args.has('--remote'));
  try {
    await initializeSchema({ local, remote });
    process.exit(0);
  } catch (error) {
    console.error('[init-db] Error:', redactError(error));
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('init-db.js')) {
  main();
}
