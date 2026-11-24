import { createServer } from 'node:http';

const PORT = process.env.LOCAL_API_PORT || 3001;
const PATH = '/api/TDDCycles/branches/branches';

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== PATH) {
    json(res, 404, { error: 'Not found' });
    return;
  }

  let data = '';
  req.on('data', chunk => { data += chunk; });
  req.on('end', () => {
    let payload;
    try {
      payload = JSON.parse(data || '{}');
    } catch {
      json(res, 400, { error: 'Invalid JSON body' });
      return;
    }

    const slug = payload?.repository?.slug;
    if (!slug || typeof slug !== 'string') {
      json(res, 400, { error: 'Bad request, missing repository.slug' });
      return;
    }

    const branches = Array.isArray(payload.branches) ? payload.branches : [];
    const commits = Array.isArray(payload.commits) ? payload.commits : [];
    const merges = Array.isArray(payload.merges) ? payload.merges : [];

    let executionsSaved = 0;
    for (const c of commits) {
      if (Array.isArray(c.tddExecutions)) {
        executionsSaved += c.tddExecutions.length;
      }
    }

    const response = {
      repository: {
        id: 0,
        slug,
        remoteUrl: payload.repository.remoteUrl,
        createdAt: new Date().toISOString(),
      },
      branchesSaved: branches.length,
      commitsSaved: commits.length,
      mergesSaved: merges.length,
      executionsSaved,
    };

    json(res, 201, response);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[local-api-server] escuchando en http://127.0.0.1:${PORT}${PATH}`);
});
