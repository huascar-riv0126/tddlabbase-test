import assert from 'node:assert/strict';
import test from 'node:test';
import NeonActivityStore from '../neonActivityStore.js';

class RecordingPool {
  constructor() {
    this.calls = [];
    this.nextId = 1;
    this.closed = false;
  }

  async query(sql, values = []) {
    const text = sql.replace(/\s+/g, ' ').trim();
    this.calls.push({ text, values });
    if (text.startsWith('INSERT INTO public.tdd_repository')) {
      return { rows: [{ id: 'repository-id' }] };
    }
    if (text.startsWith('SELECT id FROM public.tdd_branch')) {
      return { rows: [] };
    }
    if (text.startsWith('INSERT INTO public.tdd_branch')) {
      return { rows: [{ id: `branch-${this.nextId++}` }] };
    }
    if (text.startsWith('SELECT id FROM public.tdd_merge')) {
      return { rows: [] };
    }
    if (text.startsWith('INSERT INTO public.tdd_execution')) {
      return { rows: [{ id: this.nextId++ }] };
    }
    return { rows: [] };
  }

  async connect() {
    return {
      query: (sql, values) => this.query(sql, values),
      release() {},
    };
  }

  async end() {
    this.closed = true;
  }
}

test('guarda ejecuciones y actividad de push en las tablas Neon compartidas', async () => {
  const pool = new RecordingPool();
  const store = new NeonActivityStore({ pool });
  const repository = {
    slug: 'equipo/app',
    remoteUrl: 'https://github.com/equipo/app',
  };

  const executionId = await store.saveTestExecution({
    repository,
    branch: { name: 'main', forkCommitSha: 'a'.repeat(40) },
    commit: {
      sha: 'b'.repeat(40),
      parentSha: 'a'.repeat(40),
      author: 'Autora',
      message: 'feat: prueba',
      committedAt: '2026-11-24T12:00:00.000Z',
    },
    execution: {
      testsTotal: 4,
      testsPassed: 3,
      testsFailed: 1,
      executedAt: '2026-11-24T12:01:00.000Z',
    },
  });
  assert.equal(executionId, 2);

  const saved = await store.savePushActivity({
    repository,
    branches: [{ name: 'main', forkCommitSha: 'a'.repeat(40), createdAt: '2026-11-24T12:00:00.000Z' }],
    commits: [{
      commitSha: 'b'.repeat(40),
      parentCommitSha: 'a'.repeat(40),
      branch: 'main',
      authorName: 'Autora',
      message: 'feat: prueba',
      commitedAt: '2026-11-24T12:00:00.000Z',
      tddExecutions: [{ testsTotal: 4, testsPassed: 3, testsFailed: 1, executedAt: '2026-11-24T12:01:00.000Z' }],
    }],
    merges: [],
  });

  assert.deepEqual(saved, {
    repository,
    branchesSaved: 1,
    commitsSaved: 1,
    mergesSaved: 0,
    executionsSaved: 0,
  });
  const repoInsert = pool.calls.find(call => call.text.startsWith('INSERT INTO public.tdd_repository'));
  assert.deepEqual(repoInsert.values, ['app', 'https://github.com/equipo/app', 'equipo']);
  const executionInsert = pool.calls.find(call => call.text.startsWith('INSERT INTO public.tdd_execution'));
  assert.deepEqual(executionInsert.values, [
    'b'.repeat(40), 4, 3, 1, '2026-11-24',
  ]);
  assert.equal(pool.calls.filter(call => call.text.startsWith('INSERT INTO public.tdd_execution')).length, 1);
  await store.close();
  assert.equal(pool.closed, true);
});

test('revierte la transacción y propaga el error si falla el guardado', async () => {
  const pool = new RecordingPool();
  const originalQuery = pool.query.bind(pool);
  pool.query = async (sql, values) => {
    if (sql.includes('INSERT INTO public.tdd_execution')) {
      throw new Error('write failed');
    }
    return originalQuery(sql, values);
  };
  const store = new NeonActivityStore({ pool });

  await assert.rejects(store.saveTestExecution({
    repository: null,
    branch: null,
    commit: null,
    execution: {
      testsTotal: 1,
      testsPassed: 1,
      testsFailed: 0,
      executedAt: '2026-11-24T12:01:00.000Z',
    },
  }), /write failed/);
  assert.ok(pool.calls.some(call => call.text === 'ROLLBACK'));
});
