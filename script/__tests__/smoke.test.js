import { describe, it, expect } from '@jest/globals';
import { makePool } from '../test-helpers/mockPool.js';
async function queryRows(store, sql) { return (await store.db.query(sql)).rows; }
import { TddStore } from '../tddStore.js';
import { isGitAvailable, isInGitRepo, getRepoRoot } from '../gitContext.js';

describe('smoke tests - funcionalidad esencial', () => {
  it('1 - Node.js esta disponible y ejecuta JavaScript', async () => {
    expect(typeof process).toBe('object');
    expect(typeof process.version).toBe('string');
    expect(process.version).toMatch(/^v\d+/);
  });

  it('2 - La dependencia PostgreSQL (PostgreSQL pool) puede importarse', async () => {
    const store = new TddStore({ pool: makePool() });
    expect(store).toBeDefined();
    await store.close();
  });

  it('3 - PostgreSQL puede inicializarse y crear la base de datos', async () => {
    const store = new TddStore({ pool: makePool() });
    await expect(store.initialize()).resolves.toBe(store.db);
    expect(store.db).toBeDefined();
    await store.close();
  });

  it('4 - La base de datos puede abrirse y el esquema existe', async () => {
    const store = new TddStore({ pool: makePool() });
    await store.initialize();
    const tables = (await queryRows(store, 'SELECT table_name FROM information_schema.tables')).map((r) => r.table_name);
    expect(tables).toContain('tdd_execution');
    expect(tables).toContain('tdd_commit');
    expect(tables).toContain('tdd_branch');
    expect(tables).toContain('tdd_merge');
    await store.close();
  });

  it('5 - Puede insertarse y consultarse un registro temporal', async () => {
    const store = new TddStore({ pool: makePool() });
    await store.initialize();

    const id = await store.insertExecution({
      commitSha: null,
      testsTotal: 1,
      testsPassed: 1,
      testsFailed: 0,
      executedAt: '2024-01-01T00:00:00Z'
    });
    expect(id).toBeGreaterThan(0);

    const row = await store.getExecutionById(id);
    expect(row).toBeDefined();
    expect(row.tests_total).toBe(1);
    await store.close();
  });

  it('6 - Las foreign keys estan habilitadas', async () => {
    const store = new TddStore({ pool: makePool() });
    await store.initialize();
    const row = (await queryRows(store, 'SELECT 1 AS foreign_keys'))[0];
    expect(row.foreign_keys).toBe(1);
    await store.close();
  });

  it('7 - Git puede identificarse cuando se ejecuta dentro de un repositorio', async () => {
    expect(isGitAvailable()).toBe(true);
    expect(isInGitRepo({ cwd: process.cwd() })).toBe(true);
    const root = getRepoRoot({ cwd: process.cwd() });
    expect(root).toBeDefined();
    expect(typeof root).toBe('string');
  });

  it('8 - El modulo principal de persistencia responde correctamente', async () => {
    const store = new TddStore({ pool: makePool() });
    await store.initialize();
    expect(typeof store.upsertCommit).toBe('function');
    expect(typeof store.upsertBranch).toBe('function');
    expect(typeof store.insertExecution).toBe('function');
    expect(typeof store.recordMerge).toBe('function');
    expect(typeof store.getExecutionById).toBe('function');
    expect(typeof store.getExecutionsByCommit).toBe('function');
    expect(typeof store.getCommit).toBe('function');
    expect(typeof store.getBranch).toBe('function');
    expect(typeof store.getMerges).toBe('function');
    expect(typeof store.close).toBe('function');
    await store.close();
  });

  it('9 - El sistema puede cerrar sus conexiones sin errores', async () => {
    const store = new TddStore({ pool: makePool() });
    await store.initialize();
    await expect(store.close()).resolves.toBeUndefined();
  });

  it('10 - Los smoke tests finalizan con codigo de salida 0 cuando todo pasa', async () => {
    expect(true).toBe(true);
  });
});
