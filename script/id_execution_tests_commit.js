import { TddStore } from './tddStore.js';

function resolveStore() {
  return new TddStore();
}

export async function getLastExecutionId(store = null) {
  const ownStore = !store;
  if (ownStore) {
    store = resolveStore();
  }
  await store.initialize();
  try {
    const result = await store.db.query('SELECT MAX(id) AS m FROM tdd_execution');
    const row = result.rows[0];
    return (row && row.m !== null ? row.m : 0) + 1;
  } finally {
    if (ownStore) {
      await store.close();
    }
  }
}

export { TddStore };
export default { getLastExecutionId };
