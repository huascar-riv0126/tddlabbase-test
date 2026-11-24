import fs from 'fs';
import path from 'path';
import { spawn } from 'cross-spawn';
import { TddStore, nowIso } from './tddStore.js';
import { captureGitContext } from './gitContext.js';

const COMMAND = 'jest';
const args = ['--json', '--outputFile=./script/report.json'];

const DB_DIR = '.tddlab';
const DB_FILE = 'tddlab.db';

function logError(message, error) {
  console.error(`[TDD Logging] ${message}`);
  if (error) {
    console.error(`  ${error.message}`);
  }
}

function runCommand(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: 'inherit'
    });

    child.on('close', (code) => {
      resolve({ code });
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

const readJSONFile = (filePath) => {
  const rawData = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(rawData);
};

async function extractAndAddObject(reportFile, store) {
  const startTime = nowIso();

  let childResult;
  let jestError = null;

  try {
    childResult = await runCommand(COMMAND, args);
  } catch (error) {
    jestError = error;
    childResult = { code: null };
  }

  const endTime = nowIso();

  const exitCode =
    childResult && typeof childResult.code === 'number'
      ? childResult.code
      : 1;

  const success = exitCode === 0;

  let report = null;

  try {
    if (fs.existsSync(reportFile)) {
      report = readJSONFile(reportFile);
    }
  } catch (readError) {
    jestError = jestError || readError;
  }

  const hasReportTiming =
    report &&
    Number.isFinite(report.startTime) &&
    Number.isFinite(report.endTime);
  const durationMs = hasReportTiming
    ? report.endTime - report.startTime
    : Date.parse(endTime) - Date.parse(startTime);

  const testsPassed = report ? report.numPassedTests : 0;
  const testsFailed = report ? report.numFailedTests : 0;
  const testsTotal = report ? report.numTotalTests : 0;

  let gitContext;

  try {
    gitContext = captureGitContext();
  } catch (error) {
    gitContext = {
      repoRoot: null,
      headSha: null,
      branchName: null,
      isDetachedHead: false,
      parents: [],
      commitMessage: null,
      workingTreeDirty: false,
      workingTreeEntries: [],
      remoteUrl: null,
      gitAvailable: false,
      inGitRepo: false
    };
  }

  let commitId = null;
  let executionId = null;

  try {
    if (gitContext.headSha) {
      commitId = gitContext.headSha;

      const parents = gitContext.parents || [];
      const parentSha = parents.length > 0 ? parents[0] : null;

      store.upsertCommit({
        sha: gitContext.headSha,
        parentSha: parentSha || null,
        branch: gitContext.branchName || null,
        author: null,
        message: gitContext.commitMessage || null,
        committedAt: null
      });

      if (gitContext.branchName) {
        store.upsertBranch({
          name: gitContext.branchName,
          forkCommitSha: gitContext.headSha
        });
      }
    }

    executionId = store.insertExecution({
      commitSha: commitId,
      testsTotal,
      testsPassed,
      testsFailed,
      executedAt: endTime
    });

    console.log(
      `[TDD Logging] Run saved to SQLite: executionId=${executionId}, branch=${gitContext.branchName || '(no branch)'}, commit=${commitId || '(manual)'}, testsPassed=${testsPassed}, testsFailed=${testsFailed}, testsTotal=${testsTotal}`
    );
  } catch (persistError) {
    logError('Persistence failed — execution was NOT saved to SQLite:', persistError);
  }

  return {
    executionId,
    commitId,
    exitCode,
    success,
    testsPassed,
    testsFailed,
    testsTotal,
    durationMs,
    report,
    jestError
  };
}

async function main() {
  const reportFile = path.join(
    process.cwd(),
    'script',
    'report.json'
  );

  try {
    fs.mkdirSync(path.join(process.cwd(), DB_DIR), { recursive: true });
  } catch (mkdirError) {
    logError('No se pudo crear el directorio .tddlab:', mkdirError);
    process.exitCode = 1;
    return;
  }

  const store = new TddStore({
    dbPath: path.join(
      process.cwd(),
      DB_DIR,
      DB_FILE
    )
  });

  try {
    store.initialize();
  } catch (initError) {
    logError('No se pudo inicializar la base de datos SQLite:', initError);
    console.error('  Verifique que tiene permisos de escritura en:', process.cwd());
    process.exitCode = 1;
    return;
  }

  try {
    const result = await extractAndAddObject(reportFile, store);

    console.log('');
    console.log('TDD execution result:');
    console.log(`Passed: ${result.testsPassed}`);
    console.log(`Failed: ${result.testsFailed}`);
    console.log(`Total:  ${result.testsTotal}`);

    process.exitCode = result.exitCode === 0 ? 0 : 1;
  } catch (error) {
    console.error('Error while executing the TDD test runner:');
    console.error(error);

    process.exitCode = 1;
  } finally {
    store.close();
  }
}

if (process.argv[1] && path.basename(process.argv[1]) === 'tddScript.js') {
  main().catch((error) => {
    console.error('Unhandled TDD runner error:');
    console.error(error);
    process.exitCode = 1;
  });
}

export {
  extractAndAddObject,
  TddStore,
  main
};
