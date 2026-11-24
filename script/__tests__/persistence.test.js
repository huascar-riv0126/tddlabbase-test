import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
jest.mock('pg', () => { const { MockPool } = require('../test-helpers/mockPool.js'); class Pool extends MockPool {} return { default: { Pool }, Pool }; });
import { TddStore } from '../tddStore.js';
import { getLastExecutionId } from '../id_execution_tests_commit.js';
import { makePool } from '../test-helpers/mockPool.js';
async function queryOne(store, sql, values = []) { return (await store.db.query(sql, values)).rows[0]; }

describe('getLastExecutionId sobre PostgreSQL', () => {
  let store;

  beforeEach(async () => {
    store = new TddStore({ pool: makePool() });
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it('debe devolver 1 cuando no hay ejecuciones previas', async () => {
    const next = await getLastExecutionId(store);
    expect(next).toBe(1);
  });

  it('debe devolver max(id) + 1', async () => {
    await store.insertExecution({
      commitSha: null,
      testsTotal: 3,
      testsPassed: 3,
      testsFailed: 0,
      executedAt: '2024-01-01T00:00:00Z'
    });
    expect(await getLastExecutionId(store)).toBe(2);

    await store.insertExecution({
      commitSha: null,
      testsTotal: 3,
      testsPassed: 3,
      testsFailed: 0,
      executedAt: '2024-01-01T00:00:00Z'
    });
    expect(await getLastExecutionId(store)).toBe(3);
  });

  it('debe funcionar cuando se crea una instancia temporal (sin store)', async () => {
    expect(await getLastExecutionId(null)).toBe(1);
  });
});

describe('tddStore - integridad y unicidad', () => {
  let store;

  beforeEach(async () => {
    store = new TddStore({ pool: makePool() });
    await store.initialize();
    await store.upsertCommit({
      sha: 'sha-valid',
      parentSha: null,
      branch: 'main',
      author: 'A',
      message: 'valido',
      committedAt: '2024-01-01T00:00:00Z'
    });
  });

  afterEach(async () => {
    await store.close();
  });

  it('debe generar ids unicos (autoincrement)', async () => {
    const ids = new Set();
    for (let i = 0; i < 50; i++) {
      const id = await store.insertExecution({
        commitSha: 'sha-valid',
        testsTotal: 3,
        testsPassed: 3,
        testsFailed: 0,
        executedAt: '2024-01-01T00:00:00Z'
      });
      ids.add(id);
    }
    expect(ids.size).toBe(50);
  });

  it('debe aceptar commit_sha valido', async () => {
    const id = await store.insertExecution({
      commitSha: 'sha-valid',
      testsTotal: 3,
      testsPassed: 3,
      testsFailed: 0,
      executedAt: '2024-01-01T00:00:00Z'
    });
    expect(id).toBeGreaterThan(0);
    const row = await queryOne(store, 'SELECT * FROM tdd_execution WHERE id = $1', [id]);
    expect(row.commit_sha).toBe('sha-valid');
  });

  it('debe aceptar commit_sha NULL (ejecucion manual)', async () => {
    const id = await store.insertExecution({
      commitSha: null,
      testsTotal: 1,
      testsPassed: 0,
      testsFailed: 1,
      executedAt: '2024-01-01T00:00:00Z'
    });
    expect(id).toBeGreaterThan(0);
    const row = await store.getExecutionById(id);
    expect(row.commit_sha).toBeNull();
  });

  it('debe consultar ejecuciones por commit y por id', async () => {
    await store.insertExecution({
      commitSha: 'sha-valid',
      testsTotal: 3,
      testsPassed: 3,
      testsFailed: 0,
      executedAt: '2024-01-01T00:00:00Z'
    });
    await store.insertExecution({
      commitSha: 'sha-valid',
      testsTotal: 3,
      testsPassed: 2,
      testsFailed: 1,
      executedAt: '2024-01-01T00:00:05Z'
    });

    expect((await store.getExecutionsByCommit('sha-valid')).length).toBe(2);
    expect((await store.getExecutionById(1)).id).toBe(1);
    expect((await store.getExecutionById(2)).id).toBe(2);
  });
});
