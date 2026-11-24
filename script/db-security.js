import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

export function resolveLocalDbPath(dbPath = null) {
  if (dbPath) {return path.resolve(dbPath);}
  if (process.env.SQLITE_DB_PATH) {return path.resolve(process.env.SQLITE_DB_PATH);}
  const repoRoot = process.env.GIT_DIR ? path.resolve(process.env.GIT_DIR, '..') : process.cwd();
  return path.join(repoRoot, '.tddlab', 'tddlab.db');
}

export function maskDatabaseUrl(url) {
  if (!url || typeof url !== 'string') {return '(no configurada)';}
  try {
    const u = new URL(url);
    if (u.password) {u.password = '***';}
    if (u.username) {u.username = u.username ? '***' : u.username;}
    return u.toString();
  } catch {
    return '(url inválida)';
  }
}

function isLocalHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

export function validateDatabaseUrl(url, { requireSsl = process.env.REQUIRE_DB_SSL === '1', allowLocalNoSsl = process.env.ALLOW_LOCAL_DB_NO_SSL !== '0' } = {}) {
  if (!url) {throw new Error('DATABASE_URL no está configurada');}
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('DATABASE_URL tiene un formato inválido');
  }
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    throw new Error('DATABASE_URL debe usar el esquema postgres/postgresql');
  }
  if (!parsed.hostname) {throw new Error('DATABASE_URL debe incluir un host');}
  if (!parsed.pathname || parsed.pathname === '/') {
    throw new Error('DATABASE_URL debe incluir el nombre de la base de datos');
  }
  const sslmode = (parsed.searchParams.get('sslmode') || '').toLowerCase();
  const channelBinding = (parsed.searchParams.get('channel_binding') || '').toLowerCase();
  const hasSsl = sslmode && sslmode !== 'disable';
  if (requireSsl && !hasSsl && !(allowLocalNoSsl && isLocalHost(parsed.hostname))) {
    throw new Error('DATABASE_URL debe usar SSL (sslmode=require) en este entorno');
  }
  return {
    protocol: parsed.protocol,
    host: parsed.hostname,
    database: parsed.pathname.replace(/^\//, ''),
    sslmode: sslmode || null,
    channelBinding: channelBinding || null,
    secure: hasSsl,
    masked: maskDatabaseUrl(url)
  };
}

export function ensureSafeRemoteUrl(url, opts) {
  const info = validateDatabaseUrl(url, opts);
  return info;
}

export function redactError(error) {
  if (!error) {return 'Error desconocido';}
  const msg = String(error.message || error);
  return msg.replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, (m) => maskDatabaseUrl(m));
}

export function openLocalDatabase(dbPath = null) {
  const resolved = resolveLocalDbPath(dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new Database(resolved);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return { db, dbPath: resolved };
}

export default {
  resolveLocalDbPath,
  maskDatabaseUrl,
  validateDatabaseUrl,
  ensureSafeRemoteUrl,
  redactError,
  openLocalDatabase
};
