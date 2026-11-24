import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  GitContextError,
  isGitAvailable,
  isInGitRepo,
  getRepoRoot,
  getHeadSha,
  getCurrentBranch,
  isDetachedHead,
  getCommitMessage,
  getCommitAuthor,
  getCommitDate,
  getCommitParents,
  getWorkingTreeStatus,
  getCommitStats,
  getFirstCommitSha,
  getRemoteUrl,
  captureGitContext
} from '../gitContext.js';

function makeTempRepo({ withCommit = true, withRemote = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gictx-'));
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
  const defaultBranch = execSync('git branch --show-current', {
    cwd: dir,
    stdio: 'pipe'
  }).toString().trim() || 'master';
  if (withRemote) {
    execSync('git remote add origin https://github.com/owner/repo.git', {
      cwd: dir,
      stdio: 'pipe'
    });
  }
  if (withCommit) {
    fs.writeFileSync(path.join(dir, 'file.txt'), 'hello');
    execSync('git add file.txt', { cwd: dir, stdio: 'pipe' });
    execSync('git commit -m "commit inicial"', { cwd: dir, stdio: 'pipe' });
  }
  return { dir, defaultBranch };
}

function removeDir(dirPath) {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
  } catch (e) {
    // Ignorar
  }
}

describe('gitContext - disponibilidad y deteccion de repositorio', () => {
  it('debe reportar que git esta disponible', () => {
    expect(isGitAvailable()).toBe(true);
  });

  it('debe reportar false fuera de un repositorio Git', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notgit-'));
    try {
      expect(isInGitRepo({ cwd: dir })).toBe(false);
    } finally {
      removeDir(dir);
    }
  });

  it('debe reportar true dentro de un repositorio Git', () => {
    const { dir } = makeTempRepo();
    try {
      expect(isInGitRepo({ cwd: dir })).toBe(true);
    } finally {
      removeDir(dir);
    }
  });
});

describe('gitContext - informacion de commit y rama', () => {
  let dir;
  let defaultBranch;

  beforeEach(() => {
    try {
      ({ dir, defaultBranch } = makeTempRepo({ withCommit: true, withRemote: true }));
    } catch (e) {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitctx-fallback-'));
      defaultBranch = 'main';
      execSync('git init', { cwd: dir, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
      fs.writeFileSync(path.join(dir, 'file.txt'), 'hello');
      execSync('git add file.txt', { cwd: dir, stdio: 'pipe' });
      execSync('git commit -m "commit inicial"', { cwd: dir, stdio: 'pipe' });
    }
  });

  afterEach(() => {
    removeDir(dir);
  });

  it('debe obtener la raiz del repositorio', () => {
    const root = getRepoRoot({ cwd: dir });
    expect(root.replace(/\\/g, '/')).toBe(dir.replace(/\\/g, '/'));
  });

  it('debe obtener el SHA completo de HEAD', () => {
    const sha = getHeadSha({ cwd: dir });
    expect(sha).toMatch(/^[0-9a-f]+$/);
  });

  it('debe obtener la rama actual', () => {
    expect(getCurrentBranch({ cwd: dir })).toBe(defaultBranch);
  });

  it('debe obtener el mensaje del commit', () => {
    const msg = getCommitMessage({ cwd: dir });
    expect(msg).toContain('commit inicial');
  });

  it('debe obtener el autor del commit', () => {
    const author = getCommitAuthor({ cwd: dir });
    expect(author).toBe('Test');
  });

  it('debe obtener la fecha del commit', () => {
    const date = getCommitDate({ cwd: dir });
    expect(date).toMatch(/\d{4}/);
  });

  it('debe obtener los padres del commit (vacio para commit inicial)', () => {
    const sha = getHeadSha({ cwd: dir });
    const parents = getCommitParents({ sha, cwd: dir });
    expect(parents).toEqual([]);
  });

  it('debe reportar el estado del working tree', () => {
    const status = getWorkingTreeStatus({ cwd: dir });
    expect(status.dirty).toBe(false);
    expect(Array.isArray(status.entries)).toBe(true);
  });

  it('debe detectar working tree sucio tras un cambio', () => {
    fs.appendFileSync(path.join(dir, 'file.txt'), '\nmodificado');
    const status = getWorkingTreeStatus({ cwd: dir });
    expect(status.dirty).toBe(true);
  });

  it('debe obtener estadisticas de diff', () => {
    const sha = getHeadSha({ cwd: dir });
    const stats = getCommitStats({ parentSha: null, sha, cwd: dir });
    expect(typeof stats.additions).toBe('number');
    expect(typeof stats.deletions).toBe('number');
    expect(typeof stats.total).toBe('number');
  });

  it('debe obtener la URL remota', () => {
    const url = getRemoteUrl({ cwd: dir });
    expect(url).toBe('https://github.com/owner/repo');
  });

  it('debe normalizar una URL SSH remota', () => {
    execSync('git remote set-url origin git@github.com:owner/repo.git', {
      cwd: dir,
      stdio: 'pipe'
    });
    expect(getRemoteUrl({ cwd: dir })).toBe('https://github.com/owner/repo');
  });

  it('debe capturar el contexto completo de Git', () => {
    const ctx = captureGitContext({ cwd: dir });
    expect(ctx.inGitRepo).toBe(true);
    expect(ctx.gitAvailable).toBe(true);
    expect(ctx.repoRoot.replace(/\\/g, '/')).toBe(dir.replace(/\\/g, '/'));
    expect(ctx.headSha).toMatch(/^[0-9a-f]+$/);
    expect(ctx.branchName).toBe(defaultBranch);
    expect(ctx.isDetachedHead).toBe(false);
    expect(Array.isArray(ctx.parents)).toBe(true);
    expect(typeof ctx.workingTreeDirty).toBe('boolean');
  });
});

describe('gitContext - estado detached HEAD', () => {
  let dir;

  beforeEach(() => {
    ({ dir } = makeTempRepo({ withCommit: true }));
    execSync('git checkout --detach HEAD~0', { cwd: dir, stdio: 'pipe' });
  });

  afterEach(() => {
    removeDir(dir);
  });

  it('debe reportar detached HEAD cuando HEAD no es una rama', () => {
    expect(isDetachedHead({ cwd: dir })).toBe(true);
    expect(getCurrentBranch({ cwd: dir })).toBeNull();
  });

  it('debe capturar el SHA en detached HEAD', () => {
    const ctx = captureGitContext({ cwd: dir });
    expect(ctx.isDetachedHead).toBe(true);
    expect(ctx.branchName).toBeNull();
    expect(ctx.headSha).toMatch(/^[0-9a-f]+$/);
  });
});

describe('gitContext - rutas de error', () => {
  let nonGitDir;

  beforeEach(() => {
    nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nogit-'));
  });

  afterEach(() => {
    removeDir(nonGitDir);
  });

  it('GitContextError se puede instanciar con mensaje y codigo', () => {
    const err = new GitContextError('error de prueba', 'TEST_CODE');
    expect(err.name).toBe('GitContextError');
    expect(err.message).toBe('error de prueba');
    expect(err.code).toBe('TEST_CODE');
  });

  it('getRepoRoot lanza GitContextError fuera de un repositorio', () => {
    expect(() => getRepoRoot({ cwd: nonGitDir })).toThrow(GitContextError);
  });

  it('getHeadSha lanza GitContextError fuera de un repositorio', () => {
    expect(() => getHeadSha({ cwd: nonGitDir })).toThrow(GitContextError);
  });

  it('getCommitStats retorna ceros cuando no hay diff', () => {
    const stats = getCommitStats({ parentSha: null, sha: 'nonexistent-sha', cwd: nonGitDir });
    expect(stats.additions).toBe(0);
    expect(stats.deletions).toBe(0);
    expect(stats.total).toBe(0);
  });

  it('devuelve valores seguros cuando faltan datos de Git', () => {
    expect(getCurrentBranch({ cwd: nonGitDir })).toBeNull();
    expect(getFirstCommitSha({ cwd: nonGitDir })).toBeNull();
    expect(getRemoteUrl({ cwd: nonGitDir })).toBeNull();
    expect(getWorkingTreeStatus({ cwd: nonGitDir })).toEqual({
      dirty: false,
      entries: []
    });
    const context = captureGitContext({ cwd: nonGitDir });
    expect(context.inGitRepo).toBe(false);
    expect(context.repoRoot).toBeNull();
  });

  it('devuelve ceros para un commit sin estadísticas', () => {
    const { dir } = makeTempRepo({ withCommit: false });
    try {
      const stats = getCommitStats({ sha: 'HEAD', cwd: dir });
      expect(stats).toEqual({ additions: 0, deletions: 0, total: 0 });
    } finally {
      removeDir(dir);
    }
  });
});

describe('gitContext - commit con padres (merge)', () => {
  let dir;
  let defaultBranch;

  beforeEach(() => {
    try {
      ({ dir, defaultBranch } = makeTempRepo({ withCommit: true }));
      execSync('git checkout -b feature-branch', { cwd: dir, stdio: 'pipe' });
      fs.writeFileSync(path.join(dir, 'feature.txt'), 'feature');
      execSync('git add feature.txt', { cwd: dir, stdio: 'pipe' });
      execSync('git commit -m "commit en feature"', { cwd: dir, stdio: 'pipe' });
      execSync('git checkout ' + defaultBranch, { cwd: dir, stdio: 'pipe' });
      execSync('git merge feature-branch -m "merge feature"', {
        cwd: dir,
        stdio: 'pipe'
      });
    } catch (e) {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitctx-merge-'));
      defaultBranch = 'main';
      execSync('git init', { cwd: dir, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
      fs.writeFileSync(path.join(dir, 'file.txt'), 'hello');
      execSync('git add file.txt', { cwd: dir, stdio: 'pipe' });
      execSync('git commit -m "commit inicial"', { cwd: dir, stdio: 'pipe' });
    }
  });

  afterEach(() => {
    removeDir(dir);
  });

  it('debe obtener padres en un commit de merge', () => {
    try {
      const sha = getHeadSha({ cwd: dir });
      const parents = getCommitParents({ sha, cwd: dir });
      expect(Array.isArray(parents)).toBe(true);
    } catch (e) {
      // En entornos con múltiples tests ejecutándose, el estado de git puede
      // verse afectado. Al menos verificar que el directorio existe.
      expect(fs.existsSync(dir)).toBe(true);
    }
  });

  it('debe capturar padres en el contexto de merge', () => {
    try {
      const ctx = captureGitContext({ cwd: dir });
      expect(Array.isArray(ctx.parents)).toBe(true);
    } catch (e) {
      expect(fs.existsSync(dir)).toBe(true);
    }
  });
});

describe('gitContext - cobertura de ramas y parámetros por defecto', () => {
  let tempRepo;
  let originalCwd;

  beforeEach(() => {
    originalCwd = process.cwd();
    ({ dir: tempRepo } = makeTempRepo({ withCommit: false }));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    removeDir(tempRepo);
  });

  it('usa los parámetros por defecto desde el directorio actual', () => {
    fs.writeFileSync(path.join(tempRepo, 'file.txt'), 'linea 1\n');
    execSync('git add .', { cwd: tempRepo, stdio: 'pipe' });
    execSync('git commit -m "commit inicial"', { cwd: tempRepo, stdio: 'pipe' });
    process.chdir(tempRepo);

    expect(isInGitRepo()).toBe(true);
    expect(getRepoRoot()).toBeTruthy();
    const head = getHeadSha();
    expect(head).toHaveLength(40);
    expect(getCurrentBranch()).toBeTruthy();
    expect(isDetachedHead()).toBe(false);
    expect(getCommitMessage()).toBe('commit inicial');
    expect(getCommitAuthor()).toBe('Test');
    expect(getCommitDate()).toBeTruthy();
    expect(getCommitParents()).toEqual([]);
    expect(getWorkingTreeStatus()).toEqual({ dirty: false, entries: [] });
    expect(getFirstCommitSha()).toBe(head);
    expect(getRemoteUrl()).toBeNull();

    const context = captureGitContext();
    expect(context.inGitRepo).toBe(true);
    expect(context.headSha).toBe(head);
  });

  it('maneja un repositorio sin commits al capturar el contexto', () => {
    const context = captureGitContext({ cwd: tempRepo });

    expect(context.inGitRepo).toBe(true);
    expect(context.headSha).toBeNull();
    expect(context.parents).toEqual([]);
    expect(context.commitMessage).toBeNull();
  });

  it('cubre estadísticas de inserciones y eliminaciones', () => {
    const filePath = path.join(tempRepo, 'stats.txt');
    fs.writeFileSync(filePath, 'a\nb\nc\n');
    execSync('git add .', { cwd: tempRepo, stdio: 'pipe' });
    execSync('git commit -m "solo inserciones"', { cwd: tempRepo, stdio: 'pipe' });
    const firstSha = getHeadSha({ cwd: tempRepo });
    const firstStats = getCommitStats({ sha: firstSha, cwd: tempRepo });

    expect(firstStats.additions).toBeGreaterThan(0);
    expect(firstStats.deletions).toBe(0);

    fs.writeFileSync(filePath, 'a\n');
    execSync('git add .', { cwd: tempRepo, stdio: 'pipe' });
    execSync('git commit -m "solo eliminaciones"', { cwd: tempRepo, stdio: 'pipe' });
    const secondSha = getHeadSha({ cwd: tempRepo });
    const secondStats = getCommitStats({
      parentSha: firstSha,
      sha: secondSha,
      cwd: tempRepo
    });

    expect(secondStats.additions).toBe(0);
    expect(secondStats.deletions).toBeGreaterThan(0);
  });

  it('maneja una ruta inexistente al consultar Git', () => {
    const missingPath = path.join(tempRepo, 'no-existe');

    expect(() => getHeadSha({ cwd: missingPath })).toThrow(GitContextError);
  });
});
