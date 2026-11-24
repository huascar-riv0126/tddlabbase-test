import { describe, it, expect } from '@jest/globals';
import { TddStore } from '../tddStore.js';
import { makePool } from '../test-helpers/mockPool.js';

describe('TddStore - transacciones', () => {
  it('confirma una transacción exitosa', async () => {
    const pool = makePool();
    const store = new TddStore({ pool });

    await store.withTransaction(async (client) => {
      await client.query(
        `INSERT INTO tdd_execution
          (commit_sha, tests_total, tests_passed, tests_failed, executed_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        ['transaction-commit', 1, 1, 0, '2024-01-01T00:00:00Z']
      );
    });

    expect(pool.tables.tdd_execution).toHaveLength(1);
    await store.close();
  });

  it('revierte los cambios cuando la operación falla', async () => {
    const pool = makePool();
    const store = new TddStore({ pool });

    await expect(store.withTransaction(async (client) => {
      await client.query(
        `INSERT INTO tdd_execution
          (commit_sha, tests_total, tests_passed, tests_failed, executed_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        ['transaction-rollback', 1, 0, 1, '2024-01-01T00:00:00Z']
      );
      throw new Error('fallo controlado');
    })).rejects.toThrow('fallo controlado');

    expect(pool.tables.tdd_execution).toHaveLength(0);
    await store.close();
  });

  it('expone un error cuando el pool no soporta transacciones', async () => {
    const pool = makePool();
    pool.connect = undefined;
    const store = new TddStore({ pool });

    await expect(store.withTransaction(async () => {}))
      .rejects.toThrow('El pool no soporta transacciones');
    await store.close();
  });
});
