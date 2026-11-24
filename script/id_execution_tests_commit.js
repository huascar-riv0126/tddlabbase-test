import { TddStore } from './tddStore.js';

function resolveStore() {
  return new TddStore({ dbPath: ':memory:' });
}

export function getLastExecutionId(store = null) {
  const ownStore = !store;
  if (ownStore) {
    store = resolveStore();
  }
  store.initialize();
  try {
    const row = store.db
      .prepare('SELECT MAX(id) AS m FROM tdd_execution')
      .get();
    return (row && row.m !== null ? row.m : 0) + 1;
  } finally {
    if (ownStore) {
      store.close();
    }
  }
}

export { TddStore };
export default { getLastExecutionId };
