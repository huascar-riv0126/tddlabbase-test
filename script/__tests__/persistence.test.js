import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { TddStore } from '../tddStore.js';
import { getLastExecutionId } from '../id_execution_tests_commit.js';

describe('getLastExecutionId sobre SQLite', () => {
  let store;

  beforeEach(() => {
    store = new TddStore({ dbPath: ':memory:' });
    store.initialize();
  });

  afterEach(() => {
    store.close();
  });

  it('debe devolver 1 cuando no hay ejecuciones previas', () => {
    const next = getLastExecutionId(store);
    expect(next).toBe(1);
  });

  it('debe devolver max(id) + 1', () => {
    store.insertExecution({
      commitSha: null,
      testsTotal: 3,
      testsPassed: 3,
      testsFailed: 0,
      executedAt: '2024-01-01T00:00:00Z'
    });
    expect(getLastExecutionId(store)).toBe(2);

    store.insertExecution({
      commitSha: null,
      testsTotal: 3,
      testsPassed: 3,
      testsFailed: 0,
      executedAt: '2024-01-01T00:00:00Z'
    });
    expect(getLastExecutionId(store)).toBe(3);
  });

  it('debe funcionar cuando se crea una instancia temporal (sin store)', () => {
    expect(getLastExecutionId(null)).toBe(1);
  });
});

describe('tddStore - integridad y unicidad', () => {
  let store;

  beforeEach(() => {
    store = new TddStore({ dbPath: ':memory:' });
    store.initialize();
    store.upsertCommit({
      sha: 'sha-valid',
      parentSha: null,
      branch: 'main',
      author: 'A',
      message: 'valido',
      committedAt: '2024-01-01T00:00:00Z'
    });
  });

  afterEach(() => {
    store.close();
  });

  it('debe generar ids unicos (autoincrement)', () => {
    const ids = new Set();
    for (let i = 0; i < 50; i++) {
      const id = store.insertExecution({
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

  it('debe aceptar commit_sha valido', () => {
    const id = store.insertExecution({
      commitSha: 'sha-valid',
      testsTotal: 3,
      testsPassed: 3,
      testsFailed: 0,
      executedAt: '2024-01-01T00:00:00Z'
    });
    expect(id).toBeGreaterThan(0);
    const row = store.db
      .prepare('SELECT commit_sha FROM tdd_execution WHERE id = ?')
      .get(id);
    expect(row.commit_sha).toBe('sha-valid');
  });

  it('debe aceptar commit_sha NULL (ejecucion manual)', () => {
    const id = store.insertExecution({
      commitSha: null,
      testsTotal: 1,
      testsPassed: 0,
      testsFailed: 1,
      executedAt: '2024-01-01T00:00:00Z'
    });
    expect(id).toBeGreaterThan(0);
    const row = store.getExecutionById(id);
    expect(row.commit_sha).toBeNull();
  });

  it('debe consultar ejecuciones por commit y por id', () => {
    store.insertExecution({
      commitSha: 'sha-valid',
      testsTotal: 3,
      testsPassed: 3,
      testsFailed: 0,
      executedAt: '2024-01-01T00:00:00Z'
    });
    store.insertExecution({
      commitSha: 'sha-valid',
      testsTotal: 3,
      testsPassed: 2,
      testsFailed: 1,
      executedAt: '2024-01-01T00:00:05Z'
    });

    expect(store.getExecutionsByCommit('sha-valid').length).toBe(2);
    expect(store.getExecutionById(1).id).toBe(1);
    expect(store.getExecutionById(2).id).toBe(2);
  });
});
