import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { postBranchActivity } from '../branch-api.js';
import test from 'node:test';
import LocalTddStore from '../localTddStore.js';
import { collectBranchPush } from '../collect-branch-push.js';
import { computePushCommitShas } from '../sync-to-remote.js';

import { branchForApi, commitsForApi, mergesForApi, repositoryFromRemote } from '../branch-push-payload.js';

const zeroSha = '0'.repeat(40);

function createRepo(t) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'ramas-tdd-'));
  const cleanups = [];
  t.after(async () => {
    for (const cleanup of cleanups) await cleanup();
    rmSync(cwd, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '--quiet', '-b', 'main');
  git('config', 'user.name', 'Prueba');
  git('config', 'user.email', 'prueba@example.org');
  git('config', 'commit.gpgsign', 'false');
  const commit = message => {
    git('commit', '--quiet', '--allow-empty', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  return {
    cwd,
    git,
    commit,
    addCleanup: cleanup => cleanups.push(cleanup),
  };
}

test('el primer push incluye los dos commits nuevos de la rama', t => {
  const { cwd, git, commit } = createRepo(t);
  git('update-ref', 'refs/remotes/origin/main', commit('base'));
  git('switch', '--quiet', '-c', 'suma');
  const first = commit('sumar');
  const last = commit('restar');
  const ref = { remoteRef: 'refs/heads/suma', localSha: last, remoteSha: zeroSha };
  assert.deepEqual(computePushCommitShas([ref], cwd), [first, last]);
});

test('identifica el mismo repositorio por SSH y por HTTPS sin incluir credenciales', () => {
  const expected = { slug: 'equipo/base', remoteUrl: 'https://github.com/equipo/base' };
  assert.deepEqual(repositoryFromRemote('git@github.com:equipo/base.git'), expected);
  assert.deepEqual(repositoryFromRemote('https://usuario@github.com/equipo/base.git'), expected);
});

test('conserva el punto de creación de la rama aunque SQLite tenga el último commit', t => {
  const { cwd, git, commit } = createRepo(t);
  const fork = commit('inicio');
  git('switch', '--quiet', '-c', 'suma');
  const tip = commit('otro cambio');
  const branch = branchForApi('equipo/base', { name: 'suma', fork_commit_sha: tip }, null, cwd);
  assert.equal(branch.forkCommitSha, fork);
  assert.ok(Number.isFinite(Date.parse(branch.createdAt)));
  const deleted = branchForApi('equipo/base', { name: 'borrada', created_at: '2026-10-01 11:00:00' }, null, cwd);
  assert.equal(deleted.createdAt, '2026-10-01T11:00:00.000Z');
  assert.equal(deleted.forkCommitSha, undefined);
});

test('asocia cada ejecución al SHA que le corresponde y completa los commits desde Git', t => {
  const { cwd, commit } = createRepo(t);
  const first = commit('inicio');
  const second = commit('suma');
  const shas = new Map([[first, 'main'], [second, 'main']]);
  const rows = {
    commits: [{ sha: second, parent_sha: first, branch: 'main', author: null }],
    executions: [{ commit_sha: second, tests_total: 2, tests_passed: 1, tests_failed: 1, executed_at: '2026-11-01 12:00:00' }],
  };
  const [root, next] = commitsForApi('equipo/base', rows, shas, cwd);
  assert.deepEqual(root.tddExecutions, []);
  assert.equal(root.parentCommitSha, undefined);
  assert.deepEqual(next, {
    repositorySlug: 'equipo/base', commitSha: second, parentCommitSha: first, branch: 'main',
    authorName: 'Prueba', message: 'suma', commitedAt: new Date(next.commitedAt).toISOString(),
    tddExecutions: [{ testsTotal: 2, testsPassed: 1, testsFailed: 1, executedAt: '2026-11-01T12:00:00.000Z' }],
  });
});

test('incluye los merges del rango con su indicador de fast-forward', () => {
  const row = { source_branch: 'suma', target_branch: 'main', source_commit_sha: 'a', merge_commit_sha: 'b',
    is_fast_forward: 0, merged_at: '2026-11-01 12:00:00' };
  const ff = { ...row, source_commit_sha: 'c', merge_commit_sha: 'c', is_fast_forward: 1 };
  const merges = mergesForApi('equipo/base', [row, ff, { ...row, merge_commit_sha: 'otro' }], new Map([['b', 'main'], ['c', 'main']]));
  assert.equal(merges.length, 2);
  assert.deepEqual(merges[0], { repositorySlug: 'equipo/base', sourceBranch: 'suma', targetBranch: 'main',
    sourceCommitSha: 'a', mergeCommitSha: 'b', isFastForward: false, mergedAt: '2026-11-01T12:00:00.000Z' });
  assert.equal(merges[1].isFastForward, true);
});

test('usa el endpoint local aunque el entorno tenga DATABASE_URL', async t => {
  const originalEnv = process.env;
  process.env = { ...originalEnv, DATABASE_URL: 'postgresql://127.0.0.1:1/prueba' };
  delete process.env.TDD_BRANCHES_URL;
  t.after(() => { process.env = originalEnv; });
  const repository = { slug: 'equipo/base' };
  const reply = { repository, branchesSaved: 0, commitsSaved: 0, executionsSaved: 0, mergesSaved: 0 };
  const send = t.mock.method(globalThis, 'fetch', async () => Response.json(reply));
  await postBranchActivity({ repository, branches: [], commits: [], merges: [] });
  const [endpoint, options] = send.mock.calls[0].arguments;
  assert.equal(endpoint, 'http://localhost:3000/api/TDDCycles/branches/branches');
  assert.equal(options.method, 'POST');
});

test('envía un único POST y exige confirmación del servidor', async t => {
  const payload = { repository: { slug: 'equipo/base' }, branches: [], commits: [], merges: [] };
  const saved = { repository: payload.repository, branchesSaved: 0, commitsSaved: 0, mergesSaved: 0, executionsSaved: 0 };
  let status = 201;
  let reply = saved;
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }
    requests.push([req.method, req.url, req.headers['content-type'], JSON.parse(body)]);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(reply));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const route = '/api/TDDCycles/branches/branches';
  const endpoint = `http://127.0.0.1:${server.address().port}${route}`;
  assert.deepEqual(await postBranchActivity(payload, endpoint), saved);
  assert.deepEqual(requests, [['POST', route, 'application/json', payload]]);
  status = 503;
  await assert.rejects(postBranchActivity(payload, endpoint), /503/);
  status = 200;
  reply = {};
  await assert.rejects(postBranchActivity(payload, endpoint), /no confirma/);
});

test('arma el cuerpo con Git y SQLite al subir una rama distinta a la activa', async t => {
  const repo = createRepo(t);
  const { cwd, git, commit } = repo;
  git('remote', 'add', 'equipo', 'https://github.com/equipo/base.git');
  const base = commit('base');
  git('switch', '--quiet', '-c', 'division');
  const sha = commit('dividir');
  git('switch', '--quiet', 'main');
  const store = new LocalTddStore({ dbPath: path.join(cwd, 'tdd.db') });
  repo.addCleanup(() => store.close());
  await store.insertExecution({ commitSha: sha, testsTotal: 3, testsPassed: 3, testsFailed: 0 });
  const ref = `refs/heads/division ${sha} refs/heads/division ${base}`;
  const body = await collectBranchPush(store, ref, 'equipo', cwd);
  assert.equal(body.repository.slug, 'equipo/base');
  assert.deepEqual(body.branches.map(b => b.name), ['division']);
  assert.equal(body.commits.length, 1);
  assert.equal(body.commits[0].branch, 'division');
  assert.equal(body.commits[0].tddExecutions[0].testsPassed, 3);
  assert.deepEqual(body.merges, []);
  assert.equal(await collectBranchPush(store, '', 'equipo', cwd), null);
  assert.equal(await collectBranchPush(store, `(delete) ${zeroSha} refs/heads/division ${sha}`, 'equipo', cwd), null);
});

test('incluye el origen de un merge aunque el commit ya exista en el remoto Git', async t => {
  const repo = createRepo(t);
  const { cwd, git, commit } = repo;
  git('remote', 'add', 'origin', 'https://github.com/equipo/base.git');
  const base = commit('base');
  git('switch', '--quiet', '-c', 'suma');
  const source = commit('sumar');
  git('update-ref', 'refs/remotes/origin/suma', source);
  git('switch', '--quiet', 'main');
  git('merge', '--no-ff', 'suma', '-m', 'integrar suma');
  const merge = git('rev-parse', 'HEAD');
  const store = new LocalTddStore({ dbPath: path.join(cwd, 'registro.db') });
  repo.addCleanup(() => store.close());
  await store.recordMerge({ sourceBranch: 'suma', targetBranch: 'main', sourceCommitSha: source,
    mergeCommitSha: merge, isFastForward: false });
  await store.insertExecution({ commitSha: source, testsTotal: 1, testsPassed: 1, testsFailed: 0 });
  const ref = `refs/heads/main ${merge} refs/heads/main ${zeroSha}`;
  const body = await collectBranchPush(store, ref, 'origin', cwd);
  assert.deepEqual(body.commits.map(c => c.commitSha).sort(), [merge, source].sort());
  assert.equal(body.commits.find(c => c.commitSha === source).tddExecutions.length, 1);
  assert.equal(body.merges[0].sourceCommitSha, source);
  assert.equal(body.commits.some(c => c.commitSha === base), false);
});
