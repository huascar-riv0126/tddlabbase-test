import { openLocalDatabase, resolveLocalDbPath } from './db-security.js';

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tdd_schema_migration (
  version INTEGER PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS tdd_branch (
  name TEXT PRIMARY KEY,
  fork_commit_sha TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tdd_commit (
  sha TEXT PRIMARY KEY,
  parent_sha TEXT,
  branch TEXT,
  author TEXT,
  message TEXT,
  committed_at TEXT
);
CREATE TABLE IF NOT EXISTS tdd_merge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_branch TEXT NOT NULL,
  target_branch TEXT NOT NULL,
  source_commit_sha TEXT NOT NULL,
  merge_commit_sha TEXT NOT NULL,
  is_fast_forward INTEGER NOT NULL DEFAULT 0,
  merged_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tdd_execution (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commit_sha TEXT,
  tests_total INTEGER DEFAULT 0,
  tests_passed INTEGER DEFAULT 0,
  tests_failed INTEGER DEFAULT 0,
  executed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tdd_execution_commit_sha ON tdd_execution(commit_sha);
CREATE INDEX IF NOT EXISTS idx_tdd_execution_executed_at ON tdd_execution(executed_at);
`;

function nowIso() {
  return new Date().toISOString();
}

function toIntBool(v) { return v ? 1 : 0; }

export class LocalTddStore {
  constructor({ dbPath = null, db = null } = {}) {
    this.dbPath = resolveLocalDbPath(dbPath);
    this._externalDb = db;
    this.db = db || null;
    this._initialized = false;
  }

  async initialize() {
    if (this._initialized && this.db) {return this.db;}
    if (!this.db) {
      const opened = openLocalDatabase(this.dbPath);
      this.db = opened.db;
      this.dbPath = opened.dbPath;
    }
    this.db.exec(SCHEMA_SQL);
    const stmt = this.db.prepare('INSERT OR IGNORE INTO tdd_schema_migration (version) VALUES (?)');
    stmt.run(SCHEMA_VERSION);
    this._initialized = true;
    return this.db;
  }

  async close() {
    if (this.db && !this._externalDb) {
      try { this.db.close(); } catch (_) {}
    }
    this.db = this._externalDb || null;
    this._initialized = false;
  }

  async withTransaction(callback) {
    await this.initialize();
    const trx = this.db.transaction((cb) => cb(this));
    return trx(callback);
  }

  async upsertBranch({ name, forkCommitSha }) {
    await this.initialize();
    this.db.prepare(
      `INSERT INTO tdd_branch (name, fork_commit_sha) VALUES (?, ?)
       ON CONFLICT(name) DO UPDATE SET fork_commit_sha=excluded.fork_commit_sha`
    ).run(name, forkCommitSha || null);
    return name;
  }

  async upsertCommit({ sha, parentSha, branch, author, message, committedAt }) {
    await this.initialize();
    this.db.prepare(
      `INSERT INTO tdd_commit (sha, parent_sha, branch, author, message, committed_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(sha) DO UPDATE SET
         parent_sha=excluded.parent_sha,
         branch=excluded.branch,
         author=excluded.author,
         message=excluded.message,
         committed_at=excluded.committed_at`
    ).run(sha, parentSha || null, branch || null, author || null, message || null, committedAt || null);
    return sha;
  }

  async recordMerge({ sourceBranch, targetBranch, sourceCommitSha, mergeCommitSha, isFastForward, mergedAt }) {
    await this.initialize();
    const exists = this.db.prepare(
      `SELECT id FROM tdd_merge WHERE merge_commit_sha=? AND source_branch=? AND target_branch=?`
    ).get(mergeCommitSha, sourceBranch, targetBranch);
    if (exists) {return exists.id;}
    const info = this.db.prepare(
      `INSERT INTO tdd_merge (source_branch, target_branch, source_commit_sha, merge_commit_sha, is_fast_forward, merged_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(sourceBranch, targetBranch, sourceCommitSha, mergeCommitSha, toIntBool(isFastForward), mergedAt || nowIso());
    return Number(info.lastInsertRowid);
  }

  async insertExecution({ commitSha, testsTotal, testsPassed, testsFailed, executedAt }) {
    await this.initialize();
    const info = this.db.prepare(
      `INSERT INTO tdd_execution (commit_sha, tests_total, tests_passed, tests_failed, executed_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(commitSha || null, testsTotal || 0, testsPassed || 0, testsFailed || 0, executedAt || nowIso());
    return Number(info.lastInsertRowid);
  }

  async getExecutionById(id) {
    await this.initialize();
    return this.db.prepare('SELECT * FROM tdd_execution WHERE id = ?').get(id);
  }

  async getExecutionsByCommit(commitSha) {
    await this.initialize();
    return this.db.prepare('SELECT * FROM tdd_execution WHERE commit_sha = ? ORDER BY executed_at DESC').all(commitSha);
  }

  async getExecutionsByBranch() {
    await this.initialize();
    return this.db.prepare('SELECT * FROM tdd_execution ORDER BY executed_at DESC').all();
  }

  async getCommit(sha) {
    await this.initialize();
    return this.db.prepare('SELECT * FROM tdd_commit WHERE sha = ?').get(sha);
  }

  async getBranch(name) {
    await this.initialize();
    return this.db.prepare('SELECT * FROM tdd_branch WHERE name = ?').get(name);
  }

  async getMerges() {
    await this.initialize();
    return this.db.prepare('SELECT * FROM tdd_merge ORDER BY merged_at DESC').all();
  }

  async countExecutions() {
    await this.initialize();
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM tdd_execution').get();
    return row ? row.c : 0;
  }

  async countCommits() {
    await this.initialize();
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM tdd_commit').get();
    return row ? row.c : 0;
  }

  async getCommitsByBranch(branchName) {
    await this.initialize();
    return this.db.prepare('SELECT * FROM tdd_commit WHERE branch = ?').all(branchName);
  }

  async getAllBranches() {
    await this.initialize();
    return this.db.prepare('SELECT * FROM tdd_branch').all();
  }

  async getAllCommits() {
    await this.initialize();
    return this.db.prepare('SELECT * FROM tdd_commit').all();
  }

  async getAllExecutions() {
    await this.initialize();
    return this.db.prepare('SELECT * FROM tdd_execution').all();
  }

  async getAllMerges() {
    await this.initialize();
    return this.db.prepare('SELECT * FROM tdd_merge').all();
  }

  async getMergesByCommitShas(shas = []) {
    await this.initialize();
    if (!shas.length) {return [];}
    const placeholders = shas.map(() => '?').join(',');
    return this.db.prepare(
      `SELECT * FROM tdd_merge WHERE merge_commit_sha IN (${placeholders}) OR source_commit_sha IN (${placeholders})`
    ).all(...shas, ...shas);
  }

  async getExecutionsByCommitShas(shas = []) {
    await this.initialize();
    if (!shas.length) {return [];}
    const placeholders = shas.map(() => '?').join(',');
    return this.db.prepare(
      `SELECT * FROM tdd_execution WHERE commit_sha IN (${placeholders})`
    ).all(...shas);
  }

  async getCommitsByShas(shas = []) {
    await this.initialize();
    if (!shas.length) {return [];}
    const placeholders = shas.map(() => '?').join(',');
    return this.db.prepare(`SELECT * FROM tdd_commit WHERE sha IN (${placeholders})`).all(...shas);
  }
}

export { nowIso, SCHEMA_VERSION };
export default LocalTddStore;
