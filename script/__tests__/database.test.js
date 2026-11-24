import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { TddStore } from '../tddStore.js';

describe('tddStore - inicializacion y esquema SQLite', () => {
  let store;

  beforeEach(() => {
    store = new TddStore({ dbPath: ':memory:' });
    try {
      store.initialize();
    } catch (e) {}
  });

  afterEach(() => {
    try {
      store.close();
    } catch {}
  });

  it('debe crear las 4 tablas obligatorias del esquema', () => {
    const expectedTables = [
      'tdd_branch',
      'tdd_commit',
      'tdd_merge',
      'tdd_execution',
      'tdd_schema_migration'
    ];

    for (const table of expectedTables) {
      const row = store.db
        .prepare('SELECT name FROM sqlite_master WHERE type=\'table\' AND name = ?')
        .get(table);
      expect(row).toBeDefined();
      expect(row.name).toBe(table);
    }
  });

  it('debe tener foreign keys habilitadas', () => {
    const row = store.db.prepare('PRAGMA foreign_keys').get();
    expect(row.foreign_keys).toBe(1);
  });

  it('debe registrar el esquema migrado en tdd_schema_migration', () => {
    const row = store.db
      .prepare('SELECT version FROM tdd_schema_migration')
      .get();
    expect(row.version).toBe(1);
  });

  it('debe inicializarse de forma idempotente (llamar initialize dos veces)', () => {
    expect(() => store.initialize()).not.toThrow();
    expect(store.db).toBeDefined();
  });

  it('debe cerrar la conexión sin errores', () => {
    expect(() => store.close()).not.toThrow();
    const store2 = new TddStore({ dbPath: ':memory:' });
    store2.initialize();
    expect(store2.db).toBeDefined();
    store2.close();
  });
});

describe('tddStore - ramas', () => {
  let store;

  beforeEach(() => {
    store = new TddStore({ dbPath: ':memory:' });
    store.initialize();
  });

  afterEach(() => {
    store.close();
  });

  it('debe crear una rama y devolver su nombre', () => {
    const name = store.upsertBranch({
      name: 'main',
      forkCommitSha: 'abc123'
    });
    expect(name).toBe('main');

    const row = store.db
      .prepare('SELECT * FROM tdd_branch WHERE name = ?')
      .get('main');
    expect(row.name).toBe('main');
    expect(row.fork_commit_sha).toBe('abc123');
  });

  it('debe actualizar una rama existente en lugar de duplicarla', () => {
    const n1 = store.upsertBranch({
      name: 'main',
      forkCommitSha: 'sha1'
    });
    const n2 = store.upsertBranch({
      name: 'main',
      forkCommitSha: 'sha2'
    });
    expect(n1).toBe(n2);
    const row = store.db
      .prepare('SELECT fork_commit_sha FROM tdd_branch WHERE name = ?')
      .get('main');
    expect(row.fork_commit_sha).toBe('sha2');
  });

  it('debe obtener una rama por nombre', () => {
    store.upsertBranch({
      name: 'feature-x',
      forkCommitSha: 'sha-x'
    });
    const row = store.getBranch('feature-x');
    expect(row).toBeDefined();
    expect(row.name).toBe('feature-x');
    expect(row.fork_commit_sha).toBe('sha-x');
  });

  it('debe crear una rama sin fork_commit_sha (valor nulo)', () => {
    const name = store.upsertBranch({
      name: 'no-fork',
      forkCommitSha: null
    });
    expect(name).toBe('no-fork');
    const row = store.db
      .prepare('SELECT fork_commit_sha FROM tdd_branch WHERE name = ?')
      .get('no-fork');
    expect(row.fork_commit_sha).toBeNull();
  });
});

describe('tddStore - commits', () => {
  let store;

  beforeEach(() => {
    store = new TddStore({ dbPath: ':memory:' });
    store.initialize();
  });

  afterEach(() => {
    store.close();
  });

  it('debe insertar un commit sin padres (commit raiz)', () => {
    store.upsertCommit({
      sha: 'sha-root',
      parentSha: null,
      branch: 'main',
      author: 'Autor',
      message: 'commit raiz',
      committedAt: '2024-01-01T00:00:00Z'
    });
    const row = store.db
      .prepare('SELECT * FROM tdd_commit WHERE sha = ?')
      .get('sha-root');
    expect(row.author).toBe('Autor');
    expect(row.message).toBe('commit raiz');
    expect(row.parent_sha).toBeNull();

    const commit = store.getCommit('sha-root');
    expect(commit).toBeDefined();
    expect(commit.sha).toBe('sha-root');
  });

  it('debe insertar un commit con un padre (rama lineal)', () => {
    store.upsertCommit({
      sha: 'sha-parent',
      parentSha: null,
      branch: 'main',
      author: 'A',
      message: 'padre',
      committedAt: '2024-01-01T00:00:00Z'
    });
    store.upsertCommit({
      sha: 'sha-child',
      parentSha: 'sha-parent',
      branch: 'main',
      author: 'B',
      message: 'hijo',
      committedAt: '2024-01-02T00:00:00Z'
    });
    const commit = store.getCommit('sha-child');
    expect(commit.parent_sha).toBe('sha-parent');
  });

  it('debe actualizar un commit existente en lugar de duplicarlo', () => {
    store.upsertCommit({
      sha: 'sha-upd',
      parentSha: null,
      branch: 'main',
      author: 'A',
      message: 'original',
      committedAt: '2024-01-01T00:00:00Z'
    });
    store.upsertCommit({
      sha: 'sha-upd',
      parentSha: null,
      branch: 'main',
      author: 'B',
      message: 'actualizado',
      committedAt: '2024-01-02T00:00:00Z'
    });
    const row = store.db
      .prepare('SELECT message, author FROM tdd_commit WHERE sha = ?')
      .get('sha-upd');
    expect(row.message).toBe('actualizado');
    expect(row.author).toBe('B');
  });

  it('debe contar commits registrados', () => {
    expect(store.countCommits()).toBe(0);
    store.upsertCommit({
      sha: 'sha-1',
      parentSha: null,
      branch: 'main',
      author: 'A',
      message: 'm1',
      committedAt: '2024-01-01T00:00:00Z'
    });
    expect(store.countCommits()).toBe(1);
  });

  it('debe insertar un commit con todos los campos opcionales nulos', () => {
    store.upsertCommit({
      sha: 'sha-nulls',
      parentSha: null,
      branch: null,
      author: null,
      message: null,
      committedAt: null
    });
    const row = store.db
      .prepare('SELECT * FROM tdd_commit WHERE sha = ?')
      .get('sha-nulls');
    expect(row.parent_sha).toBeNull();
    expect(row.branch).toBeNull();
    expect(row.author).toBeNull();
    expect(row.message).toBeNull();
    expect(row.committed_at).toBeNull();
  });
});

describe('tddStore - merges', () => {
  let store;

  beforeEach(() => {
    store = new TddStore({ dbPath: ':memory:' });
    store.initialize();
  });

  afterEach(() => {
    store.close();
  });

  it('debe registrar un merge entre ramas', () => {
    store.recordMerge({
      sourceBranch: 'feature',
      targetBranch: 'main',
      sourceCommitSha: 'sha-feature',
      mergeCommitSha: 'sha-merge',
      isFastForward: false,
      mergedAt: '2024-01-02T00:00:00Z'
    });

    const merges = store.getMerges();
    expect(merges.length).toBe(1);
    expect(merges[0].source_branch).toBe('feature');
    expect(merges[0].target_branch).toBe('main');
    expect(merges[0].is_fast_forward).toBe(0);
  });

  it('debe registrar un merge fast-forward', () => {
    store.recordMerge({
      sourceBranch: 'feature',
      targetBranch: 'main',
      sourceCommitSha: 'sha-feature',
      mergeCommitSha: 'sha-merge',
      isFastForward: true
    });

    const merges = store.getMerges();
    expect(merges[0].is_fast_forward).toBe(1);
  });
});

describe('tddStore - ejecuciones de pruebas', () => {
  let store;

  beforeEach(() => {
    store = new TddStore({ dbPath: ':memory:' });
    store.initialize();
  });

  afterEach(() => {
    store.close();
  });

  it('debe insertar una ejecucion y devolver su id', () => {
    const id = store.insertExecution({
      commitSha: 'sha-c1',
      testsTotal: 3,
      testsPassed: 3,
      testsFailed: 0,
      executedAt: '2024-01-01T00:00:00Z'
    });
    expect(id).toBeGreaterThan(0);

    const row = store.db
      .prepare('SELECT * FROM tdd_execution WHERE id = ?')
      .get(id);
    expect(row.tests_total).toBe(3);
    expect(row.tests_passed).toBe(3);
    expect(row.tests_failed).toBe(0);
    expect(row.commit_sha).toBe('sha-c1');
  });

  it('debe permitir commit_sha NULL para ejecuciones manuales sin commit', () => {
    const id = store.insertExecution({
      commitSha: null,
      testsTotal: 1,
      testsPassed: 0,
      testsFailed: 1,
      executedAt: '2024-01-01T00:00:00Z'
    });
    const row = store.db
      .prepare('SELECT commit_sha FROM tdd_execution WHERE id = ?')
      .get(id);
    expect(row.commit_sha).toBeNull();
  });

  it('debe obtener una ejecucion por id', () => {
    store.insertExecution({
      commitSha: 'sha-c1',
      testsTotal: 3,
      testsPassed: 3,
      testsFailed: 0,
      executedAt: '2024-01-01T00:00:00Z'
    });
    const row = store.getExecutionById(1);
    expect(row).toBeDefined();
    expect(row.id).toBe(1);
  });

  it('debe obtener ejecuciones por commit', () => {
    store.insertExecution({
      commitSha: 'sha-c1',
      testsTotal: 3,
      testsPassed: 3,
      testsFailed: 0,
      executedAt: '2024-01-01T00:00:00Z'
    });
    store.insertExecution({
      commitSha: 'sha-c1',
      testsTotal: 3,
      testsPassed: 2,
      testsFailed: 1,
      executedAt: '2024-01-01T00:00:10Z'
    });
    store.insertExecution({
      commitSha: 'sha-c2',
      testsTotal: 3,
      testsPassed: 3,
      testsFailed: 0,
      executedAt: '2024-01-01T00:00:20Z'
    });

    const executions = store.getExecutionsByCommit('sha-c1');
    expect(executions.length).toBe(2);
    expect(executions[0].commit_sha).toBe('sha-c1');
    expect(executions[1].commit_sha).toBe('sha-c1');
  });

  it('debe contar ejecuciones', () => {
    expect(store.countExecutions()).toBe(0);
    store.insertExecution({
      commitSha: 'sha-c1',
      testsTotal: 3,
      testsPassed: 3,
      testsFailed: 0,
      executedAt: '2024-01-01T00:00:00Z'
    });
    expect(store.countExecutions()).toBe(1);
  });

  it('debe obtener todas las ejecuciones sin filtro (getExecutionsByBranch)', () => {
    store.insertExecution({
      commitSha: 'sha-c1',
      testsTotal: 3,
      testsPassed: 3,
      testsFailed: 0,
      executedAt: '2024-01-01T00:00:00Z'
    });
    store.insertExecution({
      commitSha: 'sha-c2',
      testsTotal: 3,
      testsPassed: 2,
      testsFailed: 1,
      executedAt: '2024-01-01T00:00:10Z'
    });

    const all = store.getExecutionsByBranch();
    expect(all.length).toBe(2);
    expect(all[0].id).toBeDefined();
    expect(all[1].id).toBeDefined();
  });
});
