import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { TddStore } from '../tddStore.js';
import { captureGitContext } from '../gitContext.js';
import { makePool } from '../test-helpers/mockPool.js';
async function queryOne(store, sql, values = []) { return (await store.db.query(sql, values)).rows[0]; }

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-'));
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
  const defaultBranch = execSync('git branch --show-current', {
    cwd: dir,
    stdio: 'pipe'
  }).toString().trim() || 'master';
  return { dir, defaultBranch };
}

function commitInRepo(dir, message) {
  const file = path.join(dir, `file_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
  fs.writeFileSync(file, message);
  execSync('git add -A', { cwd: dir, stdio: 'pipe' });
  execSync(`git commit -m "${message}"`, { cwd: dir, stdio: 'pipe' });
}

function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    // Ignorar
  }
}

async function setupStoreInRepo(repoDir) {
  const tmpDir = null;
  const store = new TddStore({ pool: makePool() });
  await store.initialize();
  const ctx = captureGitContext({ cwd: repoDir });
  return { store, ctx, tmpDir };
}

async function recordCommit(store, ctx) {
  const parents = ctx.parents || [];
  const parentSha = parents.length > 0 ? parents[0] : null;
  await store.upsertCommit({
    sha: ctx.headSha,
    parentSha,
    branch: ctx.branchName,
    author: 'Test',
    message: ctx.commitMessage,
    committedAt: '2024-01-01T00:00:00Z'
  });
  if (ctx.branchName) {
    await store.upsertBranch({
      name: ctx.branchName,
      forkCommitSha: ctx.headSha
    });
  }
}

async function recordExecution(store, commitSha, testsTotal, testsPassed, testsFailed) {
  await store.insertExecution({
    commitSha,
    testsTotal,
    testsPassed,
    testsFailed,
    executedAt: '2024-01-01T00:00:05Z'
  });
}

describe('E2E - dos ramas independientes desde una misma base', () => {
  let repoDir;
  let defaultBranch;
  let store;
  let baseSha;

  beforeEach(async () => {
    const { dir, defaultBranch: db } = makeTempRepo();
    repoDir = dir;
    defaultBranch = db;
    commitInRepo(repoDir, 'commit base en ' + defaultBranch);
    const setup = await setupStoreInRepo(repoDir);
    store = setup.store;

    const ctxBase = captureGitContext({ cwd: repoDir });
    baseSha = ctxBase.headSha;
    await recordCommit(store, ctxBase);
    await recordExecution(store, baseSha, 3, 3, 0);
  });

  afterEach(async () => {
    if (store) { await store.close(); }
    removeDir(repoDir);
  });

  it('debe mantener ejecuciones diferenciadas por commit', async () => {
    execSync('git checkout -b feature-a', { cwd: repoDir, stdio: 'pipe' });
    commitInRepo(repoDir, 'commit en feature-a');

    const ctxA = captureGitContext({ cwd: repoDir });
    await recordCommit(store, ctxA);
    await recordExecution(store, ctxA.headSha, 3, 3, 0);

    execSync('git checkout ' + defaultBranch, { cwd: repoDir, stdio: 'pipe' });
    commitInRepo(repoDir, 'otro commit en ' + defaultBranch);

    const ctxM = captureGitContext({ cwd: repoDir });
    await recordCommit(store, ctxM);
    await recordExecution(store, ctxM.headSha, 3, 3, 0);

    const byBase = await store.getExecutionsByCommit(baseSha);
    const byFeat = await store.getExecutionsByCommit(ctxA.headSha);
    expect(byBase.length).toBeGreaterThanOrEqual(1);
    expect(byFeat.length).toBe(1);

    const allIds = [...byBase, ...byFeat].map((e) => e.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('debe registrar merge commit con varios padres', async () => {
    execSync('git checkout -b feature-a', { cwd: repoDir, stdio: 'pipe' });
    commitInRepo(repoDir, 'commit en feature-a');

    const ctxA = captureGitContext({ cwd: repoDir });
    await recordCommit(store, ctxA);
    await recordExecution(store, ctxA.headSha, 3, 3, 0);

    execSync('git checkout ' + defaultBranch, { cwd: repoDir, stdio: 'pipe' });
    commitInRepo(repoDir, 'commit en ' + defaultBranch + ' despues de branch');

    const ctxM = captureGitContext({ cwd: repoDir });
    await recordCommit(store, ctxM);
    await recordExecution(store, ctxM.headSha, 3, 3, 0);

    execSync('git merge feature-a -m "merge feature-a en ' + defaultBranch + '"', {
      cwd: repoDir,
      stdio: 'pipe'
    });

    const ctxMerge = captureGitContext({ cwd: repoDir });
    await recordCommit(store, ctxMerge);

    const mergeCommit = await store.getCommit(ctxMerge.headSha);
    expect(mergeCommit).toBeDefined();
    expect(mergeCommit.sha).toMatch(/^[0-9a-f]+$/);
    expect(mergeCommit.message).toContain('merge');

    await recordExecution(store, ctxMerge.headSha, 3, 3, 0);
    expect(await store.countExecutions()).toBeGreaterThanOrEqual(4);

    const lastExec = await queryOne(store, 'SELECT * FROM tdd_execution ORDER BY id DESC LIMIT 1');
    expect(lastExec.commit_sha).toBe(ctxMerge.headSha);
  });

  it('debe preservar ejecuciones al cambiar de rama', async () => {
    const byBase = await store.getExecutionsByCommit(baseSha);
    expect(byBase.length).toBe(1);

    execSync('git checkout -b feature-a', { cwd: repoDir, stdio: 'pipe' });
    commitInRepo(repoDir, 'commit en feature-a');

    const ctxA = captureGitContext({ cwd: repoDir });
    await recordCommit(store, ctxA);
    await recordExecution(store, ctxA.headSha, 3, 3, 0);

    execSync('git checkout ' + defaultBranch, { cwd: repoDir, stdio: 'pipe' });

    const byFeat = await store.getExecutionsByCommit(ctxA.headSha);
    expect(byFeat.length).toBe(1);

    const runBase = await store.getExecutionById(1);
    expect(runBase.commit_sha).toBe(baseSha);
  });

  it('debe soportar detached HEAD (commit_sha registrado, branch NULL)', async () => {
    const sha = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();
    execSync(`git checkout --detach ${sha}`, { cwd: repoDir, stdio: 'pipe' });

    const ctx = captureGitContext({ cwd: repoDir });
    expect(ctx.branchName).toBeNull();
    expect(ctx.headSha).toBe(sha);

    await recordCommit(store, ctx);
    await recordExecution(store, sha, 3, 3, 0);

    const exec = await queryOne(store, 'SELECT * FROM tdd_execution ORDER BY id DESC LIMIT 1');
    expect(exec.commit_sha).toBe(sha);
  });
});
