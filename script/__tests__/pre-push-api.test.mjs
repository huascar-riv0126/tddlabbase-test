import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import LocalTddStore from '../localTddStore.js';

const exec = promisify(execFile);
const project = fileURLToPath(new URL('../../', import.meta.url));

test('Git conserva el push pendiente y envía el mismo registro al reintentar', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tdd-pre-push-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const cwd = path.join(dir, 'trabajo');
  const bare = path.join(dir, 'remoto.git');
  const dbPath = path.join(dir, 'prueba.db');
  const received = [];
  let status = 503;
  const server = createServer(async (req, res) => {
    let data = '';
    for await (const chunk of req) data += chunk;
    const body = JSON.parse(data);
    received.push(body);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ repository: body.repository, branchesSaved: body.branches.length,
      commitsSaved: body.commits.length, executionsSaved: 1, mergesSaved: body.merges.length }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const env = { ...process.env, HUSKY: '1', HUSKY_SKIP_TRACK: '0', SKIP_DB_SYNC: '0', SQLITE_DB_PATH: dbPath,
    TDD_BRANCHES_URL: `http://127.0.0.1:${server.address().port}/api/TDDCycles/branches/branches` };
  delete env.DATABASE_URL;
  const git = async (...args) => (await exec('git', args, { cwd, env })).stdout.trim();
  await exec('git', ['init', '--quiet', '--bare', bare]);
  await exec('git', ['init', '--quiet', '-b', 'main', cwd]);
  await cp(path.join(project, '.husky'), path.join(cwd, '.husky'), { recursive: true });
  await cp(path.join(project, 'semantic-commits.js'), path.join(cwd, 'semantic-commits.js'));
  await symlink(path.join(project, 'script'), path.join(cwd, 'script'), 'junction');
  await exec(process.execPath, [path.join(project, 'node_modules/husky/bin.js')], { cwd, env });
  await git('config', 'user.name', 'Prueba');
  await git('config', 'user.email', 'prueba@example.org');
  await git('config', 'commit.gpgsign', 'false');
  await git('remote', 'add', 'origin', 'https://github.com/equipo/base.git');
  await git('remote', 'set-url', '--push', 'origin', bare);
  await git('commit', '--allow-empty', '-m', 'feat: inicio');
  await git('switch', '-c', 'suma');
  await git('commit', '--allow-empty', '-m', 'feat: suma');
  const featureSha = await git('rev-parse', 'HEAD');
  const store = new LocalTddStore({ dbPath });
  await store.insertExecution({ commitSha: featureSha, testsTotal: 2, testsPassed: 1, testsFailed: 1 });
  await store.close();
  await git('switch', 'main');
  await git('merge', '--no-ff', 'suma', '-m', 'feat: integrar suma');
  const head = await git('rev-parse', 'HEAD');
  await assert.rejects(git('push', 'origin', 'main'), /503/);
  await assert.rejects(exec('git', ['--git-dir', bare, 'rev-parse', '--verify', 'refs/heads/main']));
  status = 201;
  await git('push', 'origin', 'main');
  assert.equal((await exec('git', ['--git-dir', bare, 'rev-parse', 'refs/heads/main'])).stdout.trim(), head);
  assert.equal(received.length, 2);
  assert.deepEqual(received[1], received[0]);
  const { repository, branches, commits, merges } = received[1];
  assert.equal(repository.slug, 'equipo/base');
  assert.deepEqual(branches.map(b => b.name).sort(), ['main', 'suma']);
  assert.equal(commits.find(c => c.commitSha === featureSha).tddExecutions[0].testsFailed, 1);
  assert.equal(merges[0].sourceBranch, 'suma');
  assert.equal(merges[0].targetBranch, 'main');
  assert.equal(merges[0].mergeCommitSha, head);

  await git('switch', '-c', 'resta');
  await git('commit', '--allow-empty', '-m', 'feat: resta');
  const tip = await git('rev-parse', 'HEAD');
  await git('switch', 'main');
  await git('merge', '--ff-only', 'resta');
  await git('push', 'origin', 'main');
  const ff = received.at(-1);
  assert.deepEqual(ff.commits.map(c => [c.commitSha, c.branch]), [[tip, 'resta']]);
  assert.equal(ff.merges[0].sourceCommitSha, tip);
  assert.equal(ff.merges[0].isFastForward, true);

  const manual = exec(process.execPath, [path.join(project, 'script/pre-push-sync.js')], { cwd, env });
  manual.child.stdin.end();
  await manual;
  assert.equal(received.length, 4);
  assert.deepEqual(received.at(-1).commits.map(c => c.commitSha), [tip]);

  await exec(process.execPath, [path.join(project, 'script/pre-push-sync.js'), '--commit', featureSha.slice(0, 8)], { cwd, env });
  assert.deepEqual(received.at(-1).commits.map(c => c.commitSha), [featureSha]);
  assert.equal(received.at(-1).commits[0].tddExecutions[0].testsPassed, 1);
  await assert.rejects(exec(process.execPath, [path.join(project, 'script/pre-push-sync.js'), '--commit', 'HEAD'], { cwd, env }));
  assert.equal(received.length, 5);
});
