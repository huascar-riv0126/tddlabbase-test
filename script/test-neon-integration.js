import 'dotenv/config';
import { randomUUID } from 'crypto';
import NeonActivityStore from './neonActivityStore.js';
import { redactError } from './db-security.js';

if (process.env.RUN_NEON_INTEGRATION !== '1') {
  console.log('Neon integration skipped. Set RUN_NEON_INTEGRATION=1 to run it.');
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL no está configurada.');
  process.exit(1);
}

const store = new NeonActivityStore();
const id = randomUUID();
const repository = {
  slug: `tddlab-test/${id}`,
  remoteUrl: `https://github.com/tddlab-test/${id}`,
};
const branch = { name: `integration-${id}`, forkCommitSha: null };
const commitSha = id.replace(/-/g, '');
let initialized = false;

try {
  await store.initialize();
  initialized = true;
  await store.saveTestExecution({
    repository,
    branch,
    commit: {
      sha: commitSha,
      parentSha: null,
      author: 'Neon integration test',
      message: 'temporary integration record',
      committedAt: new Date().toISOString(),
    },
    execution: {
      testsTotal: 1,
      testsPassed: 1,
      testsFailed: 0,
      executedAt: new Date().toISOString(),
    },
  });

  await store.savePushActivity({
    repository,
    branches: [{
      ...branch,
      createdAt: new Date().toISOString(),
    }],
    commits: [{
      commitSha,
      branch: branch.name,
      authorName: 'Neon integration test',
      message: 'temporary integration record',
      commitedAt: new Date().toISOString(),
      tddExecutions: [],
    }],
    merges: [],
  });

  const result = await store.pool.query(
    'SELECT COUNT(*)::integer AS count FROM public.tdd_execution WHERE commit_sha = $1',
    [commitSha]
  );
  if (result.rows[0].count !== 1) {
    throw new Error('La ejecución no se guardó exactamente una vez en Neon.');
  }
  console.log('Neon integration passed.');
} catch (error) {
  console.error('Neon integration failed:', redactError(error));
  process.exitCode = 1;
} finally {
  try {
    if (initialized) {
      await store.pool.query(
        'DELETE FROM public.tdd_execution WHERE commit_sha = $1',
        [commitSha]
      );
      await store.pool.query('DELETE FROM public.tdd_commit WHERE sha = $1', [commitSha]);
      await store.pool.query(
        `DELETE FROM public.tdd_branch
         WHERE repo_id = (
           SELECT id FROM public.tdd_repository WHERE repo_url = $1
         )`,
        [repository.remoteUrl]
      );
      await store.pool.query(
        'DELETE FROM public.tdd_repository WHERE repo_url = $1',
        [repository.remoteUrl]
      );
    }
  } finally {
    await store.close();
  }
}
