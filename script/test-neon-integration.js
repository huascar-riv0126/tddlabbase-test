import 'dotenv/config';
import { randomUUID } from 'crypto';
import TddStore from './tddStore.js';

if (process.env.RUN_NEON_INTEGRATION !== '1') {
  console.log('Neon integration skipped. Set RUN_NEON_INTEGRATION=1 to run it.');
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL no está configurada.');
  process.exit(1);
}

const store = new TddStore();
const branchName = `integration-${randomUUID()}`;

try {
  await store.initialize();
  const connection = await store.pool.query('SELECT 1 AS connected');
  if (connection.rows[0].connected !== 1) {
    throw new Error('La conexión con Neon no devolvió el resultado esperado');
  }

  await store.withTransaction(async (client) => {
    await client.query(
      'INSERT INTO tdd_branch (name, fork_commit_sha) VALUES ($1, $2)',
      [branchName, 'integration-sha']
    );
  });

  const inserted = await store.getBranch(branchName);
  if (!inserted) {
    throw new Error('No se pudo verificar la inserción en Neon');
  }

  try {
    await store.withTransaction(async (client) => {
      await client.query(
        'INSERT INTO tdd_branch (name, fork_commit_sha) VALUES ($1, $2)',
        [`${branchName}-rollback`, 'rollback-sha']
      );
      throw new Error('rollback-check');
    });
  } catch (error) {
    if (error.message !== 'rollback-check') {
      throw error;
    }
  }

  const rolledBack = await store.getBranch(`${branchName}-rollback`);
  if (rolledBack) {
    throw new Error('La transacción no revirtió el registro de prueba');
  }

  console.log('Neon integration passed.');
} catch (error) {
  console.error('Neon integration failed:', error.message);
  process.exitCode = 1;
} finally {
  try {
    await store.pool.query('DELETE FROM tdd_branch WHERE name = $1', [branchName]);
  } finally {
    await store.close();
  }
}
