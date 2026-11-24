import { describe, it, expect, afterEach, jest } from '@jest/globals';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { makePool } from '../test-helpers/mockPool.js';

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adapter-hooks-'));
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, 'file.txt'), 'base');
  execFileSync('git', ['add', 'file.txt'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'base'], { cwd: dir, stdio: 'pipe' });
  return dir;
}

function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('TDDLogBDAdapter y hooks de Git', () => {
  let originalCwd;
  let exitMock;
  let repoDir;

  afterEach(() => {
    if (originalCwd) {
      process.chdir(originalCwd);
      originalCwd = null;
    }
    exitMock?.mockRestore();
    if (repoDir) {
      removeDir(repoDir);
      repoDir = null;
    }
  });

  it('expone el adaptador compatible sin duplicar la persistencia', async () => {
    const { TDDLogBDAdapter } = await import('../TDDLogBDAdapter.js');
    const { TddStore } = await import('../tddStore.js');
    const adapter = new TDDLogBDAdapter({ pool: makePool() });

    expect(adapter).toBeInstanceOf(TddStore);
    expect(typeof adapter.insertExecution).toBe('function');
    await adapter.close();
  });

  it('registra la rama actual mediante el rastreador de checkout', async () => {
    repoDir = makeTempRepo();
    originalCwd = process.cwd();
    process.chdir(repoDir);
    exitMock = jest.spyOn(process, 'exit').mockImplementation(() => {});

    const { main, TDDLogBDAdapter } = await import('../branch-tracker.js');
    const pool = makePool();
    await main(new TDDLogBDAdapter({ pool }));

    const branch = execFileSync('git', ['branch', '--show-current'], {
      cwd: repoDir,
      encoding: 'utf8'
    }).trim();
    expect(pool.tables.tdd_branch).toEqual([
      expect.objectContaining({ name: branch })
    ]);
    expect(exitMock).toHaveBeenCalledWith(0);
  });

  it('registra un merge no fast-forward mediante el rastreador de merge', async () => {
    repoDir = makeTempRepo();
    originalCwd = process.cwd();
    process.chdir(repoDir);
    const defaultBranch = execFileSync('git', ['branch', '--show-current'], {
      cwd: repoDir,
      encoding: 'utf8'
    }).trim();

    execFileSync('git', ['checkout', '-b', 'feature'], { cwd: repoDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(repoDir, 'feature.txt'), 'feature');
    execFileSync('git', ['add', 'feature.txt'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'feature'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['checkout', defaultBranch], { cwd: repoDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(repoDir, 'main.txt'), 'main');
    execFileSync('git', ['add', 'main.txt'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'main'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['merge', 'feature', '-m', 'merge feature'], {
      cwd: repoDir,
      stdio: 'pipe'
    });

    exitMock = jest.spyOn(process, 'exit').mockImplementation(() => {});
    const { main, TDDLogBDAdapter } = await import('../merge-tracker.js');
    const pool = makePool();
    await main(new TDDLogBDAdapter({ pool }));

    expect(pool.tables.tdd_merge).toEqual([
      expect.objectContaining({
        source_branch: 'feature',
        target_branch: defaultBranch,
        is_fast_forward: 0
      })
    ]);
    expect(exitMock).toHaveBeenCalledWith(0);
  });

  it('registra un merge fast-forward', async () => {
    repoDir = makeTempRepo();
    originalCwd = process.cwd();
    process.chdir(repoDir);
    const defaultBranch = execFileSync('git', ['branch', '--show-current'], {
      cwd: repoDir,
      encoding: 'utf8'
    }).trim();

    execFileSync('git', ['checkout', '-b', 'feature'], { cwd: repoDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(repoDir, 'feature.txt'), 'feature');
    execFileSync('git', ['add', 'feature.txt'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'feature'], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['checkout', defaultBranch], { cwd: repoDir, stdio: 'pipe' });
    execFileSync('git', ['merge', 'feature'], { cwd: repoDir, stdio: 'pipe' });

    exitMock = jest.spyOn(process, 'exit').mockImplementation(() => {});
    const { main, TDDLogBDAdapter } = await import('../merge-tracker.js');
    const pool = makePool();
    await main(new TDDLogBDAdapter({ pool }));

    expect(pool.tables.tdd_merge).toEqual([
      expect.objectContaining({
        source_branch: 'feature',
        target_branch: defaultBranch,
        is_fast_forward: 1
      })
    ]);
    expect(exitMock).toHaveBeenCalledWith(0);
  });
});
