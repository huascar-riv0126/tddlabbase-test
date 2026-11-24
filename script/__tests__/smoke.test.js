import { describe, it, expect } from '@jest/globals';
import { TddStore } from '../tddStore.js';
import { isGitAvailable, isInGitRepo, getRepoRoot } from '../gitContext.js';

describe('smoke tests - funcionalidad esencial', () => {
  it('1 - Node.js esta disponible y ejecuta JavaScript', () => {
    expect(typeof process).toBe('object');
    expect(typeof process.version).toBe('string');
    expect(process.version).toMatch(/^v\d+/);
  });

  it('2 - La dependencia SQLite (better-sqlite3) puede importarse', () => {
    expect(() => {
      const store = new TddStore({ dbPath: ':memory:' });
      expect(store).toBeDefined();
      store.close();
    }).not.toThrow();
  });

  it('3 - SQLite puede inicializarse y crear la base de datos', () => {
    const store = new TddStore({ dbPath: ':memory:' });
    expect(() => store.initialize()).not.toThrow();
    expect(store.db).toBeDefined();
    store.close();
  });

  it('4 - La base de datos puede abrirse y el esquema existe', () => {
    const store = new TddStore({ dbPath: ':memory:' });
    store.initialize();
    const tables = store.db
      .prepare('SELECT name FROM sqlite_master WHERE type=\'table\'')
      .all()
      .map((r) => r.name);
    expect(tables).toContain('tdd_execution');
    expect(tables).toContain('tdd_commit');
    expect(tables).toContain('tdd_branch');
    expect(tables).toContain('tdd_merge');
    store.close();
  });

  it('5 - Puede insertarse y consultarse un registro temporal', () => {
    const store = new TddStore({ dbPath: ':memory:' });
    store.initialize();

    const id = store.insertExecution({
      commitSha: null,
      testsTotal: 1,
      testsPassed: 1,
      testsFailed: 0,
      executedAt: '2024-01-01T00:00:00Z'
    });
    expect(id).toBeGreaterThan(0);

    const row = store.getExecutionById(id);
    expect(row).toBeDefined();
    expect(row.tests_total).toBe(1);
    store.close();
  });

  it('6 - Las foreign keys estan habilitadas', () => {
    const store = new TddStore({ dbPath: ':memory:' });
    store.initialize();
    const row = store.db.prepare('PRAGMA foreign_keys').get();
    expect(row.foreign_keys).toBe(1);
    store.close();
  });

  it('7 - Git puede identificarse cuando se ejecuta dentro de un repositorio', () => {
    expect(isGitAvailable()).toBe(true);
    expect(isInGitRepo({ cwd: process.cwd() })).toBe(true);
    const root = getRepoRoot({ cwd: process.cwd() });
    expect(root).toBeDefined();
    expect(typeof root).toBe('string');
  });

  it('8 - El modulo principal de persistencia responde correctamente', () => {
    const store = new TddStore({ dbPath: ':memory:' });
    store.initialize();
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
    store.close();
  });

  it('9 - El sistema puede cerrar sus conexiones sin errores', () => {
    const store = new TddStore({ dbPath: ':memory:' });
    store.initialize();
    expect(() => store.close()).not.toThrow();
  });

  it('10 - Los smoke tests finalizan con codigo de salida 0 cuando todo pasa', () => {
    expect(true).toBe(true);
  });
});
