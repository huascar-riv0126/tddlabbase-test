import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hooks-'));
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, 'file.txt'), 'hello');
  execSync('git add file.txt', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "commit inicial"', { cwd: dir, stdio: 'pipe' });
  return dir;
}

function removeDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) {
    // Ignorar
  }
}

async function getDb() {
  const mod = await import('better-sqlite3');
  return mod.default;
}

describe('commitScript.js - funcion main', () => {
  let exitMock;
  let originalCwd;
  let repoDir;

  beforeEach(async () => {
    exitMock = jest.spyOn(process, 'exit').mockImplementation(() => {});
    originalCwd = process.cwd();
    repoDir = makeTempRepo();
    process.chdir(repoDir);
  });

  afterEach(() => {
    exitMock.mockRestore();
    process.chdir(originalCwd);
    removeDir(repoDir);
  });

  it('debe insertar el commit con SHA real en SQLite y salir con codigo 0', async () => {
    const mod = await import('../commitScript.js');
    const { main } = mod;
    main();
    expect(exitMock).toHaveBeenCalledWith(0);

    const dbPath = path.join(repoDir, '.tddlab', 'tddlab.db');
    expect(fs.existsSync(dbPath)).toBe(true);

    const Database = await getDb();
    const headSha = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();
    const db = new Database(dbPath, { readonly: true });
    const commit = db.prepare('SELECT * FROM tdd_commit WHERE sha = ?').get(headSha);
    expect(commit).toBeDefined();
    expect(commit.message).toBe('commit inicial');
    expect(commit.sha).toMatch(/^[0-9a-f]+$/);
    db.close();
  });

  it('no debe registrar el literal HEAD como sha', async () => {
    const mod = await import('../commitScript.js');
    const { main } = mod;
    main();
    const dbPath = path.join(repoDir, '.tddlab', 'tddlab.db');
    const Database = await getDb();
    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare('SELECT sha FROM tdd_commit').all();
    db.close();
    for (const row of rows) {
      expect(row.sha).not.toBe('HEAD');
      expect(row.sha).toMatch(/^[0-9a-f]+$/);
    }
  });
});

describe('commit-tracker.js - funcion main', () => {
  let exitMock;
  let originalCwd;
  let repoDir;

  beforeEach(() => {
    exitMock = jest.spyOn(process, 'exit').mockImplementation(() => {});
    originalCwd = process.cwd();
    repoDir = makeTempRepo();
    process.chdir(repoDir);
  });

  afterEach(() => {
    exitMock.mockRestore();
    process.chdir(originalCwd);
    removeDir(repoDir);
  });

  it('debe insertar el commit en SQLite sin relanzar Jest y salir con codigo 0', async () => {
    const mod = await import('../commit-tracker.js');
    const { main } = mod;
    main();
    expect(exitMock).toHaveBeenCalledWith(0);

    const dbPath = path.join(repoDir, '.tddlab', 'tddlab.db');
    expect(fs.existsSync(dbPath)).toBe(true);

    const Database = await getDb();
    const headSha = execSync('git rev-parse HEAD', { cwd: repoDir, stdio: 'pipe' }).toString().trim();
    const db = new Database(dbPath, { readonly: true });
    const commit = db.prepare('SELECT * FROM tdd_commit WHERE sha = ?').get(headSha);
    expect(commit).toBeDefined();
    expect(commit.sha).not.toBe('HEAD');
    db.close();
  });
});

describe('tddScript.js - exportaciones y TddStore', () => {
  it('debe exportar extractAndAddObject y TddStore', async () => {
    const mod = await import('../tddScript.js');
    expect(typeof mod.extractAndAddObject).toBe('function');
    expect(typeof mod.TddStore).toBe('function');
  });

  it('TddStore debe poder inicializarse desde tddScript', async () => {
    const { TddStore } = await import('../tddScript.js');
    const store = new TddStore({ dbPath: ':memory:' });
    store.initialize();
    expect(store.db).toBeDefined();
    store.close();
  });
});

describe('commitScript.js - ruta de error (no git repo)', () => {
  let exitMock;
  let originalCwd;
  let nonGitDir;

  beforeEach(async () => {
    exitMock = jest.spyOn(process, 'exit').mockImplementation(() => {});
    originalCwd = process.cwd();
    nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nogit-'));
    process.chdir(nonGitDir);
  });

  afterEach(() => {
    exitMock.mockRestore();
    process.chdir(originalCwd);
    removeDir(nonGitDir);
  });

  it('debe salir con codigo 1 cuando no hay repositorio Git (captureGitContext lanza)', async () => {
    const mod = await import('../commitScript.js');
    const { main } = mod;
    main();
    expect(exitMock).toHaveBeenCalledWith(1);
  });
});

describe('commitScript.js - ruta de error (excepcion en main)', () => {
  let exitMock;
  let originalCwd;
  let repoDir;

  beforeEach(async () => {
    exitMock = jest.spyOn(process, 'exit').mockImplementation(() => {});
    originalCwd = process.cwd();
    repoDir = makeTempRepo();
    process.chdir(repoDir);
  });

  afterEach(() => {
    exitMock.mockRestore();
    process.chdir(originalCwd);
    removeDir(repoDir);
  });

  it('debe cerrar store y salir con codigo 1 ante error inesperado', async () => {
    const mod = await import('../commitScript.js');

    // Sobrescribir captureGitContext para lanzar error
    const gitCtxMod = await import('../gitContext.js');
    const originalCapture = gitCtxMod.captureGitContext;
    gitCtxMod.captureGitContext = () => {
      throw new Error('Error inesperado');
    };

    const { main } = mod;
    main();
    expect(exitMock).toHaveBeenCalledWith(1);

    gitCtxMod.captureGitContext = originalCapture;
  });

  it('debe cubrir catch interno cuando store.close lanza al cerrar (commitScript)', async () => {
    const mod = await import('../commitScript.js');

    const gitCtxMod = await import('../gitContext.js');
    const originalCapture = gitCtxMod.captureGitContext;
    gitCtxMod.captureGitContext = () => {
      throw new Error('Error inesperado');
    };

    const originalClose = mod.TddStore.prototype.close;
    mod.TddStore.prototype.close = jest.fn(() => {
      throw new Error('Close failed');
    });

    const { main } = mod;
    main();
    expect(exitMock).toHaveBeenCalledWith(1);

    mod.TddStore.prototype.close = originalClose;
    gitCtxMod.captureGitContext = originalCapture;
  });
});

describe('commit-tracker.js - ruta de error (no git repo)', () => {
  let exitMock;
  let originalCwd;
  let nonGitDir;

  beforeEach(async () => {
    exitMock = jest.spyOn(process, 'exit').mockImplementation(() => {});
    originalCwd = process.cwd();
    nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nogit-'));
    process.chdir(nonGitDir);
  });

  afterEach(() => {
    exitMock.mockRestore();
    process.chdir(originalCwd);
    removeDir(nonGitDir);
  });

  it('debe salir con codigo 1 cuando no hay repositorio Git (captureGitContext lanza)', async () => {
    const mod = await import('../commit-tracker.js');
    const { main } = mod;
    main();
    expect(exitMock).toHaveBeenCalledWith(1);
  });
});

describe('commit-tracker.js - ruta de error (excepcion en main)', () => {
  let exitMock;
  let originalCwd;
  let repoDir;

  beforeEach(async () => {
    exitMock = jest.spyOn(process, 'exit').mockImplementation(() => {});
    originalCwd = process.cwd();
    repoDir = makeTempRepo();
    process.chdir(repoDir);
  });

  afterEach(() => {
    exitMock.mockRestore();
    process.chdir(originalCwd);
    removeDir(repoDir);
  });

  it('debe cerrar store y salir con codigo 1 ante error inesperado', async () => {
    const mod = await import('../commit-tracker.js');

    const gitCtxMod = await import('../gitContext.js');
    const originalCapture = gitCtxMod.captureGitContext;
    gitCtxMod.captureGitContext = () => {
      throw new Error('Error inesperado');
    };

    const { main } = mod;
    main();
    expect(exitMock).toHaveBeenCalledWith(1);

    gitCtxMod.captureGitContext = originalCapture;
  });

  it('debe cubrir catch interno cuando store.close lanza al cerrar (commit-tracker)', async () => {
    const mod = await import('../commit-tracker.js');

    const gitCtxMod = await import('../gitContext.js');
    const originalCapture = gitCtxMod.captureGitContext;
    gitCtxMod.captureGitContext = () => {
      throw new Error('Error inesperado');
    };

    const originalClose = mod.TddStore.prototype.close;
    mod.TddStore.prototype.close = jest.fn(() => {
      throw new Error('Close failed');
    });

    const { main } = mod;
    main();
    expect(exitMock).toHaveBeenCalledWith(1);

    mod.TddStore.prototype.close = originalClose;
    gitCtxMod.captureGitContext = originalCapture;
  });
});
