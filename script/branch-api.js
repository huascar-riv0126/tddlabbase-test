const defaultEndpoint = 'http://localhost:3000/api/TDDCycles/branches/branches';

export async function postBranchActivity(payload, endpoint = process.env.TDD_BRANCHES_URL || defaultEndpoint) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`La API de ramas respondió con HTTP ${response.status}.`);
  }
  const saved = await response.json();
  const counters = ['branchesSaved', 'commitsSaved', 'mergesSaved', 'executionsSaved'];
  if (saved?.repository?.slug !== payload.repository.slug ||
      !counters.every(key => Number.isInteger(saved[key]) && saved[key] >= 0)) {
    throw new Error('La respuesta de la API no confirma el registro de la actividad TDD.');
  }
  return saved;
}
