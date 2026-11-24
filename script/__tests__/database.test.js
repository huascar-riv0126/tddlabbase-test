import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { TddStore } from '../tddStore.js';
import { makePool } from '../test-helpers/mockPool.js';

async function queryOne(store, sql, values = []) { return (await store.db.query(sql, values)).rows[0]; }

describe('tddStore - inicializacion y esquema PostgreSQL', () => {
  let store;

  beforeEach(async () => {
    store = new TddStore({ pool: makePool() });
    try {
      await store.initialize();
    } catch (e) {}
  });

  afterEach(async () => {
    try {
      await store.close();
    } catch {}
  });

  it('debe crear las 4 tablas obligatorias del esquema', async () => {
    const expectedTables = [
      'tdd_branch',
      'tdd_commit',
      'tdd_merge',
      'tdd_execution',
      'tdd_schema_migration'
    ];

    for (const table of expectedTables) {
      const row = await queryOne(store, 'SELECT table_name FROM information_schema.tables WHERE table_name = $1', [table]);
      expect(row).toBeDefined();
      expect(row.name).toBe(table);
    }
  });

  it('debe tener foreign keys habilitadas', async () => {
    const row = await queryOne(store, 'SELECT 1 AS foreign_keys');
    expect(row.foreign_keys).toBe(1);
  });

  it('debe registrar el esquema migrado en tdd_schema_migration', async () => {
    const row = await queryOne(store, 'SELECT version FROM tdd_schema_migration');
    expect(row.version).toBe(1);
  });

  it('debe inicializarse de forma idempotente (llamar initialize dos veces)', async () => {
    await expect(store.initialize()).resolves.toBe(store.db);
    expect(store.db).toBeDefined();
  });

  it('debe cerrar la conexión sin errores', async () => {
    await expect(store.close()).resolves.toBeUndefined();
    const store2 = new TddStore({ pool: makePool() });
    await store2.initialize();
    expect(store2.db).toBeDefined();
    await store2.close();
  });
});

describe('tddStore - ramas', () => {
  let store;

  beforeEach(async () => {
    store = new TddStore({ pool: makePool() });
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it('debe crear una rama y devolver su nombre', async () => {
    const name = await store.upsertBranch({
      name: 'main',
      forkCommitSha: 'abc123'
    });
    expect(name).toBe('main');

    const row = await queryOne(store, 'SELECT * FROM tdd_branch WHERE name = $1', ['main']);
    expect(row.name).toBe('main');
    expect(row.fork_commit_sha).toBe('abc123');
  });

  it('debe actualizar una rama existente en lugar de duplicarla', async () => {
    const n1 = await store.upsertBranch({
      name: 'main',
      forkCommitSha: 'sha1'
    });
    const n2 = await store.upsertBranch({
      name: 'main',
      forkCommitSha: 'sha2'
    });
    expect(n1).toBe(n2);
    const row = await queryOne(store, 'SELECT fork_commit_sha FROM tdd_branch WHERE name = $1', ['main']);
    expect(row.fork_commit_sha).toBe('sha2');
  });

  it('debe obtener una rama por nombre', async () => {
    await store.upsertBranch({
      name: 'feature-x',
      forkCommitSha: 'sha-x'
    });
    const row = await store.getBranch('feature-x');
    expect(row).toBeDefined();
    expect(row.name).toBe('feature-x');
    expect(row.fork_commit_sha).toBe('sha-x');
  });

  it('debe crear una rama sin fork_commit_sha (valor nulo)', async () => {
    const name = await store.upsertBranch({
      name: 'no-fork',
      forkCommitSha: null
    });
    expect(name).toBe('no-fork');
    const row = await queryOne(store, 'SELECT fork_commit_sha FROM tdd_branch WHERE name = $1', ['no-fork']);
    expect(row.fork_commit_sha).toBeNull();
  });
});

describe('tddStore - commits', () => {
  let store;

  beforeEach(async () => {
    store = new TddStore({ pool: makePool() });
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it('debe insertar un commit sin padres (commit raiz)', async () => {
    await store.upsertCommit({
      sha: 'sha-root',
      parentSha: null,
      branch: 'main',
      author: 'Autor',
      message: 'commit raiz',
      committedAt: '2024-01-01T00:00:00Z'
    });
    const row = await queryOne(store, 'SELECT * FROM tdd_commit WHERE sha = $1', ['sha-root']);
    expect(row.author).toBe('Autor');
    expect(row.message).toBe('commit raiz');
    expect(row.parent_sha).toBeNull();

    const commit = await store.getCommit('sha-root');
    expect(commit).toBeDefined();
    expect(commit.sha).toBe('sha-root');
  });

  it('debe insertar un commit con un padre (rama lineal)', async () => {
    await store.upsertCommit({
      sha: 'sha-parent',
      parentSha: null,
      branch: 'main',
      author: 'A',
      message: 'padre',
      committedAt: '2024-01-01T00:00:00Z'
    });
    await store.upsertCommit({
      sha: 'sha-child',
      parentSha: 'sha-parent',
      branch: 'main',
      author: 'B',
      message: 'hijo',
      committedAt: '2024-01-02T00:00:00Z'
    });
    const commit = await store.getCommit('sha-child');
    expect(commit.parent_sha).toBe('sha-parent');
  });

  it('debe actualizar un commit existente en lugar de duplicarlo', async () => {
    await store.upsertCommit({
      sha: 'sha-upd',
      parentSha: null,
      branch: 'main',
      author: 'A',
      message: 'original',
      committedAt: '2024-01-01T00:00:00Z'
    });
    await store.upsertCommit({
      sha: 'sha-upd',
      parentSha: null,
      branch: 'main',
      author: 'B',
      message: 'actualizado',
      committedAt: '2024-01-02T00:00:00Z'
    });
    const row = await queryOne(store, 'SELECT * FROM tdd_commit WHERE sha = $1', ['sha-upd']);
    expect(row.message).toBe('actualizado');
    expect(row.author).toBe('B');
  });

  it('debe contar commits registrados', async () => {
    expect(await store.countCommits()).toBe(0);
    await store.upsertCommit({
      sha: 'sha-1',
      parentSha: null,
      branch: 'main',
      author: 'A',
      message: 'm1',
      committedAt: '2024-01-01T00:00:00Z'
    });
    expect(await store.countCommits()).toBe(1);
  });

  it('debe insertar un commit con todos los campos opcionales nulos', async () => {
    await store.upsertCommit({
      sha: 'sha-nulls',
      parentSha: null,
      branch: null,
      author: null,
      message: null,
      committedAt: null
    });
    const row = await queryOne(store, 'SELECT * FROM tdd_commit WHERE sha = $1', ['sha-nulls']);
    expect(row.parent_sha).toBeNull();
    expect(row.branch).toBeNull();
    expect(row.author).toBeNull();
    expect(row.message).toBeNull();
    expect(row.committed_at).toBeNull();
  });
});

describe('tddStore - merges', () => {
  let store;

  beforeEach(async () => {
    store = new TddStore({ pool: makePool() });
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it('debe registrar un merge entre ramas', async () => {
    await store.recordMerge({
      sourceBranch: 'feature',
      targetBranch: 'main',
      sourceCommitSha: 'sha-feature',
      mergeCommitSha: 'sha-merge',
      isFastForward: false,
      mergedAt: '2024-01-02T00:00:00Z'
    });

    const merges = await store.getMerges();
    expect(merges.length).toBe(1);
    expect(merges[0].source_branch).toBe('feature');
    expect(merges[0].target_branch).toBe('main');
    expect(merges[0].is_fast_forward).toBe(0);
  });

  it('debe registrar un merge fast-forward', async () => {
    await store.recordMerge({
      sourceBranch: 'feature',
      targetBranch: 'main',
      sourceCommitSha: 'sha-feature',
      mergeCommitSha: 'sha-merge',
      isFastForward: true
    });

    const merges = await store.getMerges();
    expect(merges[0].is_fast_forward).toBe(1);
  });
});

describe('tddStore - ejecuciones de pruebas', () => {
  let store;

  beforeEach(async () => {
    store = new TddStore({ pool: makePool() });
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
  });

  it('debe insertar una ejecucion y devolver su id', async () => {
    const id = await store.insertExecution({
      commitSha: 'sha-c1',
      testsTotal: 3,
      testsPassed: 3,
      testsFailed: 0,
      executedAt: '2024-01-01T00:00:00Z'
    });
    expect(id).toBeGreaterThan(0);

    const row = await queryOne(store, 'SELECT * FROM tdd_execution WHERE id = $1', [id]);
    expect(row.tests_total).toBe(3);
    expect(row.tests_passed).toBe(3);
    expect(row.tests_failed).toBe(0);
    expect(row.commit_sha).toBe('sha-c1');
  });

  it('debe permitir commit_sha NULL para ejecuciones manuales sin commit', async () => {
    const id = await store.insertExecution({
      commitSha: null,
      testsTotal: 1,
      testsPassed: 0,
      testsFailed: 1,
      executedAt: '2024-01-01T00:00:00Z'
    });
    const row = await queryOne(store, 'SELECT * FROM tdd_execution WHERE id = $1', [id]);
    expect(row.commit_sha).toBeNull();
  });

  it('debe obtener una ejecucion por id', async () => {
    await store.insertExecution({
      commitSha: 'sha-c1',
      testsTotal: 3,
      testsPassed: 3,
      testsFailed: 0,
      executedAt: '2024-01-01T00:00:00Z'
    });
    const row = await store.getExecutionById(1);
    expect(row).toBeDefined();
    expect(row.id).toBe(1);
  });

  it('debe obtener ejecuciones por commit', async () => {
    await store.insertExecution({
      commitSha: 'sha-c1',
      testsTotal: 3,
      testsPassed: 3,
      testsFailed: 0,
      executedAt: '2024-01-01T00:00:00Z'
    });
    await store.insertExecution({
      commitSha: 'sha-c1',
      testsTotal: 3,
      testsPassed: 2,
      testsFailed: 1,
      executedAt: '2024-01-01T00:00:10Z'
    });
    await store.insertExecution({
      commitSha: 'sha-c2',
      testsTotal: 3,
      testsPassed: 3,
      testsFailed: 0,
      executedAt: '2024-01-01T00:00:20Z'
    });

    const executions = await store.getExecutionsByCommit('sha-c1');
    expect(executions.length).toBe(2);
    expect(executions[0].commit_sha).toBe('sha-c1');
    expect(executions[1].commit_sha).toBe('sha-c1');
  });

  it('debe contar ejecuciones', async () => {
    expect(await store.countExecutions()).toBe(0);
    await store.insertExecution({
      commitSha: 'sha-c1',
      testsTotal: 3,
      testsPassed: 3,
      testsFailed: 0,
      executedAt: '2024-01-01T00:00:00Z'
    });
    expect(await store.countExecutions()).toBe(1);
  });

  it('debe obtener todas las ejecuciones sin filtro (getExecutionsByBranch)', async () => {
    await store.insertExecution({
      commitSha: 'sha-c1',
      testsTotal: 3,
      testsPassed: 3,
      testsFailed: 0,
      executedAt: '2024-01-01T00:00:00Z'
    });
    await store.insertExecution({
      commitSha: 'sha-c2',
      testsTotal: 3,
      testsPassed: 2,
      testsFailed: 1,
      executedAt: '2024-01-01T00:00:10Z'
    });

    const all = await store.getExecutionsByBranch();
    expect(all.length).toBe(2);
    expect(all[0].id).toBeDefined();
    expect(all[1].id).toBeDefined();
  });
});
