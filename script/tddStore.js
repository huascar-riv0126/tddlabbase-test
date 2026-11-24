import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DEFAULT_DB_DIR = '.tddlab';
const DEFAULT_DB_FILE = 'tddlab.db';
const SCHEMA_VERSION = 1;

const SCHEMA = `
PRAGMA foreign_keys = ON;

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

const MIGRATION_SCHEMA = `
DROP TABLE IF EXISTS tdd_repository;
DROP TABLE IF EXISTS tdd_commit_parent;
DROP TABLE IF EXISTS tdd_run_failures;
DROP TABLE IF EXISTS tdd_event_log;
DROP TABLE IF EXISTS tdd_branch;
DROP TABLE IF EXISTS tdd_commit;
DROP TABLE IF EXISTS tdd_execution;
DROP TABLE IF EXISTS tdd_merge;
`;

const MIGRATIONS = [
  {
    version: 1,
    up: `
      CREATE TABLE IF NOT EXISTS tdd_schema_migration (
        version INTEGER PRIMARY KEY
      );
    `
  }
];

function nowIso() {
  return new Date().toISOString();
}

export class TddStore {
  constructor({ dbPath } = {}) {
    const dbDir = dbPath ? path.dirname(dbPath) : DEFAULT_DB_DIR;
    const dbFile = dbPath || path.join(DEFAULT_DB_DIR, DEFAULT_DB_FILE);
    this.dbPath = dbFile;
    this.dbDir = dbDir;
    this.db = null;
    this._initialized = false;
  }

  initialize() {
    if (this._initialized) { return this.db; }
    fs.mkdirSync(this.dbDir, { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this._applySchema();
    this._initialized = true;
    return this.db;
  }

  _applySchema() {
    this.db.exec(MIGRATIONS[0].up);
    const row = this.db.prepare('SELECT MAX(version) AS v FROM tdd_schema_migration').get();
    const current = row && row.v ? row.v : 0;

    if (current < SCHEMA_VERSION) {
      const tx = this.db.transaction(() => {
        this.db.exec(MIGRATION_SCHEMA);
        this.db.exec(SCHEMA);
        const insert = this.db.prepare('INSERT INTO tdd_schema_migration (version) VALUES (?)');
        insert.run(SCHEMA_VERSION);
      });
      tx();
    } else {
      this.db.exec(SCHEMA);
    }
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      this._initialized = false;
    }
  }

  upsertBranch({ name, forkCommitSha }) {
    this.initialize();
    const existing = this.db
      .prepare('SELECT name FROM tdd_branch WHERE name = ?')
      .get(name);
    if (existing) {
      this.db
        .prepare('UPDATE tdd_branch SET fork_commit_sha = ? WHERE name = ?')
        .run(forkCommitSha || null, name);
      return name;
    }
    this.db
      .prepare(
        'INSERT INTO tdd_branch (name, fork_commit_sha) VALUES (?, ?)'
      )
      .run(name, forkCommitSha || null);
    return name;
  }

  upsertCommit({ sha, parentSha, branch, author, message, committedAt }) {
    this.initialize();
    const existing = this.db
      .prepare('SELECT sha FROM tdd_commit WHERE sha = ?')
      .get(sha);
    if (existing) {
      this.db
        .prepare(
          `UPDATE tdd_commit SET
            parent_sha = ?, branch = ?, author = ?, message = ?, committed_at = ?
          WHERE sha = ?`
        )
        .run(parentSha || null, branch || null, author || null, message || null, committedAt || null, sha);
    } else {
      this.db
        .prepare(
          `INSERT INTO tdd_commit
            (sha, parent_sha, branch, author, message, committed_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(sha, parentSha || null, branch || null, author || null, message || null, committedAt || null);
    }
    return sha;
  }

  recordMerge({ sourceBranch, targetBranch, sourceCommitSha, mergeCommitSha, isFastForward, mergedAt }) {
    this.initialize();
    const insert = this.db.prepare(
      `INSERT INTO tdd_merge
        (source_branch, target_branch, source_commit_sha, merge_commit_sha, is_fast_forward, merged_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    insert.run(
      sourceBranch,
      targetBranch,
      sourceCommitSha,
      mergeCommitSha,
      isFastForward ? 1 : 0,
      mergedAt || nowIso()
    );
  }

  insertExecution({ commitSha, testsTotal, testsPassed, testsFailed, executedAt }) {
    this.initialize();
    const insert = this.db.prepare(
      `INSERT INTO tdd_execution
        (commit_sha, tests_total, tests_passed, tests_failed, executed_at)
       VALUES (?, ?, ?, ?, ?)`
    );
    const result = insert.run(
      commitSha || null,
      testsTotal || 0,
      testsPassed || 0,
      testsFailed || 0,
      executedAt || nowIso()
    );
    return result.lastInsertRowid;
  }

  getExecutionById(id) {
    this.initialize();
    return this.db
      .prepare('SELECT * FROM tdd_execution WHERE id = ?')
      .get(id);
  }

  getExecutionsByCommit(commitSha) {
    this.initialize();
    return this.db
      .prepare('SELECT * FROM tdd_execution WHERE commit_sha = ? ORDER BY executed_at DESC')
      .all(commitSha);
  }

  getExecutionsByBranch() {
    this.initialize();
    return this.db
      .prepare('SELECT * FROM tdd_execution ORDER BY executed_at DESC')
      .all();
  }

  getCommit(sha) {
    this.initialize();
    return this.db
      .prepare('SELECT * FROM tdd_commit WHERE sha = ?')
      .get(sha);
  }

  getBranch(name) {
    this.initialize();
    return this.db
      .prepare('SELECT * FROM tdd_branch WHERE name = ?')
      .get(name);
  }

  getMerges() {
    this.initialize();
    return this.db
      .prepare('SELECT * FROM tdd_merge ORDER BY merged_at DESC')
      .all();
  }

  countExecutions() {
    this.initialize();
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM tdd_execution').get();
    return row ? row.c : 0;
  }

  countCommits() {
    this.initialize();
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM tdd_commit').get();
    return row ? row.c : 0;
  }
}

export { nowIso, DEFAULT_DB_DIR, DEFAULT_DB_FILE, SCHEMA_VERSION };
export default TddStore;
