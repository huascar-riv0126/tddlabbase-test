import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest
} from '@jest/globals';

import fs from 'fs';
import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';

jest.mock('cross-spawn', () => ({
  spawn: jest.fn()
}));

import { spawn } from 'cross-spawn';
jest.mock('pg', () => { const { MockPool } = require('../test-helpers/mockPool.js'); class Pool extends MockPool {} return { default: { Pool }, Pool }; });
import { TddStore } from '../tddStore.js';
import LocalTddStore from '../localTddStore.js';
import { extractAndAddObject } from '../tddScript.js';
import { makePool } from '../test-helpers/mockPool.js';

const mockSpawn = spawn;

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tdscript-'));
}

function removeDir(dirPath) {
  try {
    fs.rmSync(dirPath, {
      recursive: true,
      force: true
    });
  } catch {
    // Ignorar errores durante la limpieza.
  }
}

function mockSpawnExit(code) {
  mockSpawn.mockImplementation(() => {
    const emitter = new EventEmitter();

    process.nextTick(() => {
      emitter.emit('close', code);
    });

    return emitter;
  });
}

describe(
  'tddScript.js - extractAndAddObject con store real y spawn mockeado',
  () => {
    let tmpDir;
    let reportFile;
    let store;

    beforeEach(async () => {
      tmpDir = makeTempDir();
      reportFile = path.join(tmpDir, 'script', 'report.json');

      fs.mkdirSync(path.dirname(reportFile), {
        recursive: true
      });

      fs.writeFileSync(
        reportFile,
        JSON.stringify({
          numPassedTests: 3,
          numFailedTests: 0,
          numTotalTests: 3,
          startTime: Date.now(),
          endTime: Date.now() + 5000,
          success: true,
          coverageMap: {}
        })
      );

      store = new TddStore({
        pool: makePool()
      });

      await store.initialize();
      mockSpawnExit(0);
    });

    afterEach(async () => {
      await store.close();
      removeDir(tmpDir);
      jest.clearAllMocks();
    });

    it('debe registrar una ejecucion exitosa en PostgreSQL', async () => {
      const result = await extractAndAddObject(reportFile, store);

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.testsPassed).toBe(3);
      expect(result.executionId).toBeDefined();

      const execution = await store.getExecutionById(result.executionId);

      expect(execution).toBeDefined();
      expect(execution.tests_total).toBe(3);
      expect(execution.tests_passed).toBe(3);
      expect(mockSpawn).toHaveBeenCalled();
    });

    it('conserva SQLite y reporta el fallo si Neon no acepta la ejecución', async () => {
      const neonStore = {
        saveTestExecution: jest.fn().mockRejectedValue(new Error('Neon unavailable'))
      };

      const result = await extractAndAddObject(reportFile, store, neonStore);

      expect(result.persistenceError).toMatchObject({ message: 'Neon unavailable' });
      expect(await store.getExecutionById(result.executionId)).toBeDefined();
      expect(neonStore.saveTestExecution).toHaveBeenCalled();
    });

    it(
      'debe registrar la ejecucion aunque el reporte de Jest no tenga endTime',
      async () => {
        const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
        delete report.endTime;
        fs.writeFileSync(reportFile, JSON.stringify(report));

        const result = await extractAndAddObject(reportFile, store);
        const execution = await store.getExecutionById(result.executionId);

        expect(execution).toBeDefined();
        expect(Number.isNaN(Date.parse(execution.executed_at))).toBe(false);
      }
    );

    it(
      'debe manejar Jest fallido sin tratarlo como error de persistencia',
      async () => {
        mockSpawnExit(1);

        const result = await extractAndAddObject(reportFile, store);

        expect(result.success).toBe(false);
        expect(result.exitCode).toBe(1);

        const execution = await store.getExecutionById(result.executionId);

        expect(execution).toBeDefined();
        expect(execution.tests_failed).toBeGreaterThanOrEqual(0);
      }
    );

    it(
      'debe manejar Jest que falla al lanzar',
      async () => {
        mockSpawn.mockImplementation(() => {
          throw new Error('Jest no encontrado');
        });

        const result = await extractAndAddObject(reportFile, store);

        expect(result.success).toBe(false);
        expect(result.jestError).toBeDefined();

        const execution = await store.getExecutionById(result.executionId);

        expect(execution).toBeDefined();
      }
    );

    it(
      'debe funcionar sin repositorio Git',
      async () => {
        const nonGitDir = fs.mkdtempSync(
          path.join(os.tmpdir(), 'nogit-')
        );

        const originalCwd = process.cwd();

        process.chdir(nonGitDir);

        const nonGitReport = path.join(
          nonGitDir,
          'script',
          'report.json'
        );

        fs.mkdirSync(path.dirname(nonGitReport), {
          recursive: true
        });

        fs.writeFileSync(
          nonGitReport,
          JSON.stringify({
            numPassedTests: 1,
            numFailedTests: 0,
            numTotalTests: 1,
            startTime: Date.now(),
            endTime: Date.now() + 1000,
            success: true
          })
        );

        try {
          const result = await extractAndAddObject(
            nonGitReport,
            store
          );

          expect(result.executionId).toBeDefined();

          const execution = await store.getExecutionById(
            result.executionId
          );

          expect(execution.commit_sha).toBeNull();
        } finally {
          process.chdir(originalCwd);
          removeDir(nonGitDir);
        }
      }
    );

    it(
      'debe manejar error de persistencia sin confundirlo con fallo de Jest',
      async () => {
        const failingStore = {
          initialize: jest.fn(),
          close: jest.fn(),
          upsertCommit: jest.fn(),
          upsertBranch: jest.fn(),
          insertExecution: jest.fn(() => {
            throw new Error('DB write failed');
          }),
          db: {
            prepare: jest.fn(() => ({
              get: jest.fn(() => undefined)
            }))
          }
        };

        mockSpawnExit(0);

        const result = await extractAndAddObject(
          reportFile,
          failingStore
        );

        expect(result.success).toBe(true);
        expect(result.exitCode).toBe(0);
      }
    );

    it(
      'debe registrar ejecucion con fallos de prueba',
      async () => {
        fs.writeFileSync(
          reportFile,
          JSON.stringify({
            numPassedTests: 1,
            numFailedTests: 2,
            numTotalTests: 3,
            startTime: Date.now(),
            endTime: Date.now() + 5000,
            success: false,
            testResults: [
              {
                testFilePath: 'src/sumador.test.js',
                failureMessages: [
                  'Expected 3 to be 4'
                ]
              }
            ]
          })
        );

        mockSpawnExit(1);

        const result = await extractAndAddObject(
          reportFile,
          store
        );

        expect(result.success).toBe(false);
        expect(result.exitCode).toBe(1);
        expect(result.testsFailed).toBe(2);

        const execution = await store.getExecutionById(
          result.executionId
        );

        expect(execution.tests_failed).toBe(2);
      }
    );

    it(
      'debe registrar ejecucion con commit y rama',
      async () => {
        const result = await extractAndAddObject(
          reportFile,
          store
        );

        expect(result.success).toBe(true);
        expect(result.commitId).toBeDefined();
        expect(result.commitId).toMatch(/^[0-9a-f]+$/);

        const execution = await store.getExecutionById(
          result.executionId
        );

        expect(execution.commit_sha).toBe(result.commitId);
      }
    );

    it(
      'debe manejar error de lectura del reporte JSON',
      async () => {
        const originalReadFileSync = fs.readFileSync;
        fs.readFileSync = () => {
          throw new Error('No se puede leer el archivo');
        };
        try {
          const result = await extractAndAddObject(reportFile, store);
          // exitCode es 0 (jest ok), pero jestError está definido
          expect(result.success).toBe(true);
          expect(result.jestError).toBeDefined();
        } finally {
          fs.readFileSync = originalReadFileSync;
        }
      }
    );

    it(
      'debe manejar error de captura de contexto Git',
      async () => {
        const mod = await import('../gitContext.js');
        const originalCapture = mod.captureGitContext;
        mod.captureGitContext = () => {
          throw new Error('No hay contexto Git');
        };
        try {
          const result = await extractAndAddObject(reportFile, store);
          const execution = await store.getExecutionById(result.executionId);
          expect(execution.commit_sha).toBeNull();
        } finally {
          mod.captureGitContext = originalCapture;
        }
      }
    );

    it(
      'debe manejar fallo de persistencia sin fallar la ejecucion',
      async () => {
        const failingStore = {
          initialize: jest.fn(),
          close: jest.fn(),
          upsertCommit: jest.fn(),
          upsertBranch: jest.fn(),
          insertExecution: jest.fn(() => {
            throw new Error('DB write failed');
          }),
          db: {
            prepare: jest.fn(() => ({
              get: jest.fn(() => undefined)
            }))
          }
        };

        mockSpawnExit(0);

        const result = await extractAndAddObject(reportFile, failingStore);

        expect(result.success).toBe(true);
        expect(result.exitCode).toBe(0);
        expect(failingStore.insertExecution).toHaveBeenCalled();
      }
    );

    it(
      'debe manejar evento de error en spawn (runCommand error)',
      async () => {
        mockSpawn.mockImplementation(() => {
          const emitter = new EventEmitter();
          process.nextTick(() => {
            emitter.emit('error', new Error('Spawn failed'));
          });
          return emitter;
        });

        const result = await extractAndAddObject(reportFile, store);

        expect(result.success).toBe(false);
        expect(result.jestError).toBeDefined();
        expect(result.exitCode).toBe(1);
      }
    );

    it('guarda localmente y envía la ejecución a Neon', async () => {
      const previousEnv = process.env;
      const dbPath = path.join(tmpDir, 'registro.db');
      const local = new LocalTddStore({ dbPath });
      const previousCwd = process.cwd();
      try {
        process.env = { ...previousEnv, DATABASE_URL: 'postgresql://127.0.0.1:1/prueba', SQLITE_DB_PATH: dbPath };
        delete process.env.TDD_BRANCHES_URL;
        process.chdir(tmpDir);
        const { main } = await import('../tddScript.js');
        const neonStore = { saveTestExecution: jest.fn().mockResolvedValue(1) };
        await main(undefined, undefined, neonStore);
        expect(process.exitCode).toBe(0);
        const run = await local.getExecutionById(1);
        expect(run.tests_passed).toBe(3);
        expect(neonStore.saveTestExecution).toHaveBeenCalledWith(
          expect.objectContaining({
            execution: expect.objectContaining({
              testsTotal: 3,
              testsPassed: 3,
              testsFailed: 0
            })
          })
        );
      } finally {
        await local.close();
        process.chdir(previousCwd);
        process.env = previousEnv;
        process.exitCode = undefined;
      }
    });

    it(
      'debe ejecutar main y salir con codigo 0 cuando todo sale bien',
      async () => {
        const originalCwd = process.cwd();
        const mainTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'main-'));
        process.chdir(mainTmpDir);
        process.exitCode = undefined;

        try {
          const mod = await import('../tddScript.js');
          await mod.main(undefined, undefined, { saveTestExecution: jest.fn() });
          expect(process.exitCode).toBe(0);
        } finally {
          process.chdir(originalCwd);
          removeDir(mainTmpDir);
          process.exitCode = undefined;
        }
      }
    );

    it(
      'debe ejecutar main y salir con codigo 1 cuando store.initialize falla',
      async () => {
        const originalCwd = process.cwd();
        const mainTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'main-'));
        process.chdir(mainTmpDir);
        process.exitCode = undefined;

        try {
          const mod = await import('../tddScript.js');

          jest.spyOn(LocalTddStore.prototype, 'initialize').mockRejectedValue(new Error('DB init failed'));
          await mod.main(undefined, undefined, { saveTestExecution: jest.fn() });
          expect(process.exitCode).toBe(1);
        } finally {
          process.chdir(originalCwd);
          removeDir(mainTmpDir);
          process.exitCode = undefined;
        }
      }
    );

    it('debe manejar un fallo inesperado del ejecutor y cerrar el store', async () => {
      const mod = await import('../tddScript.js');
      const fakeStore = {
        initialize: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined)
      };
      process.exitCode = undefined;

      await mod.main(fakeStore, jest.fn().mockRejectedValue(new Error('runner failed')));

      expect(fakeStore.close).toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      process.exitCode = undefined;
    });

    it('debe conservar el error si falla el cierre después del ejecutor', async () => {
      const mod = await import('../tddScript.js');
      const fakeStore = {
        initialize: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockRejectedValue(new Error('close failed'))
      };
      process.exitCode = undefined;

      await expect(
        mod.main(fakeStore, jest.fn().mockRejectedValue(new Error('runner failed')))
      ).rejects.toThrow('close failed');
      process.exitCode = undefined;
    });
  }
);
