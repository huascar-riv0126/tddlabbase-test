import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { TddStore } from '../tddStore.js';
import { captureGitContext } from '../gitContext.js';

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

function setupStoreInRepo(repoDir) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-'));
  const dbPath = path.join(tmpDir, 'tddlab.db');
  const store = new TddStore({ dbPath });
  store.initialize();
  const ctx = captureGitContext({ cwd: repoDir });
  return { store, ctx, tmpDir };
}

function recordCommit(store, ctx) {
  const parents = ctx.parents || [];
  const parentSha = parents.length > 0 ? parents[0] : null;
  store.upsertCommit({
    sha: ctx.headSha,
    parentSha,
    branch: ctx.branchName,
    author: 'Test',
    message: ctx.commitMessage,
    committedAt: '2024-01-01T00:00:00Z'
  });
  if (ctx.branchName) {
    store.upsertBranch({
      name: ctx.branchName,
      forkCommitSha: ctx.headSha
    });
  }
}

function recordExecution(store, commitSha, testsTotal, testsPassed, testsFailed) {
  store.insertExecution({
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

  beforeEach(() => {
    const { dir, defaultBranch: db } = makeTempRepo();
    repoDir = dir;
    defaultBranch = db;
    commitInRepo(repoDir, 'commit base en ' + defaultBranch);
    const setup = setupStoreInRepo(repoDir);
    store = setup.store;

    const ctxBase = captureGitContext({ cwd: repoDir });
    baseSha = ctxBase.headSha;
    recordCommit(store, ctxBase);
    recordExecution(store, baseSha, 3, 3, 0);
  });

  afterEach(() => {
    if (store) { store.close(); }
    removeDir(repoDir);
  });

  it('debe mantener ejecuciones diferenciadas por commit', () => {
    execSync('git checkout -b feature-a', { cwd: repoDir, stdio: 'pipe' });
    commitInRepo(repoDir, 'commit en feature-a');

    const ctxA = captureGitContext({ cwd: repoDir });
    recordCommit(store, ctxA);
    recordExecution(store, ctxA.headSha, 3, 3, 0);

    execSync('git checkout ' + defaultBranch, { cwd: repoDir, stdio: 'pipe' });
    commitInRepo(repoDir, 'otro commit en ' + defaultBranch);

    const ctxM = captureGitContext({ cwd: repoDir });
    recordCommit(store, ctxM);
    recordExecution(store, ctxM.headSha, 3, 3, 0);

    const byBase = store.getExecutionsByCommit(baseSha);
    const byFeat = store.getExecutionsByCommit(ctxA.headSha);
    expect(byBase.length).toBeGreaterThanOrEqual(1);
    expect(byFeat.length).toBe(1);

    const allIds = [...byBase, ...byFeat].map((e) => e.id);
    expect(new Set(allIds).size).toBe(allIds.length);
  });

  it('debe registrar merge commit con varios padres', () => {
    execSync('git checkout -b feature-a', { cwd: repoDir, stdio: 'pipe' });
    commitInRepo(repoDir, 'commit en feature-a');

    const ctxA = captureGitContext({ cwd: repoDir });
    recordCommit(store, ctxA);
    recordExecution(store, ctxA.headSha, 3, 3, 0);

    execSync('git checkout ' + defaultBranch, { cwd: repoDir, stdio: 'pipe' });
    commitInRepo(repoDir, 'commit en ' + defaultBranch + ' despues de branch');

    const ctxM = captureGitContext({ cwd: repoDir });
    recordCommit(store, ctxM);
    recordExecution(store, ctxM.headSha, 3, 3, 0);

    execSync('git merge feature-a -m "merge feature-a en ' + defaultBranch + '"', {
      cwd: repoDir,
      stdio: 'pipe'
    });

    const ctxMerge = captureGitContext({ cwd: repoDir });
    recordCommit(store, ctxMerge);

    const mergeCommit = store.getCommit(ctxMerge.headSha);
    expect(mergeCommit).toBeDefined();
    expect(mergeCommit.sha).toMatch(/^[0-9a-f]+$/);
    expect(mergeCommit.message).toContain('merge');

    recordExecution(store, ctxMerge.headSha, 3, 3, 0);
    expect(store.countExecutions()).toBeGreaterThanOrEqual(4);

    const lastExec = store.db
      .prepare('SELECT * FROM tdd_execution ORDER BY id DESC LIMIT 1')
      .get();
    expect(lastExec.commit_sha).toBe(ctxMerge.headSha);
  });

  it('debe preservar ejecuciones al cambiar de rama', () => {
    const byBase = store.getExecutionsByCommit(baseSha);
    expect(byBase.length).toBe(1);

    execSync('git checkout -b feature-a', { cwd: repoDir, stdio: 'pipe' });
    commitInRepo(repoDir, 'commit en feature-a');

    const ctxA = captureGitContext({ cwd: repoDir });
    recordCommit(store, ctxA);
    recordExecution(store, ctxA.headSha, 3, 3, 0);

    execSync('git checkout ' + defaultBranch, { cwd: repoDir, stdio: 'pipe' });

    const byFeat = store.getExecutionsByCommit(ctxA.headSha);
    expect(byFeat.length).toBe(1);

    const runBase = store.getExecutionById(1);
    expect(runBase.commit_sha).toBe(baseSha);
  });

  it('debe soportar detached HEAD (commit_sha registrado, branch NULL)', () => {
    const sha = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();
    execSync(`git checkout --detach ${sha}`, { cwd: repoDir, stdio: 'pipe' });

    const ctx = captureGitContext({ cwd: repoDir });
    expect(ctx.branchName).toBeNull();
    expect(ctx.headSha).toBe(sha);

    recordCommit(store, ctx);
    recordExecution(store, sha, 3, 3, 0);

    const exec = store.db
      .prepare('SELECT * FROM tdd_execution ORDER BY id DESC LIMIT 1')
      .get();
    expect(exec.commit_sha).toBe(sha);
  });
});
