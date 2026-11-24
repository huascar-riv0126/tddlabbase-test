export class MockPool {
  constructor() {
    this.closed = false;
    this.tables = {
      tdd_schema_migration: [],
      tdd_branch: [],
      tdd_commit: [],
      tdd_merge: [],
      tdd_execution: []
    };
    this.nextMergeId = 1;
    this.nextExecutionId = 1;
  }

  async query(sql, values = []) {
    const text = sql.replace(/\s+/g, ' ').trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(text)) {return { rows: [] };}
    if (/^CREATE TABLE|^CREATE INDEX/i.test(text)) {return { rows: [] };}
    if (/INSERT INTO tdd_schema_migration/i.test(text)) {
      if (!this.tables.tdd_schema_migration.some((r) => r.version === values[0])) {
        this.tables.tdd_schema_migration.push({ version: values[0] });
      }
      return { rows: [] };
    }
    if (/INSERT INTO tdd_branch/i.test(text)) {
      const existing = this.tables.tdd_branch.find((r) => r.name === values[0]);
      if (existing) {existing.fork_commit_sha = values[1] ?? null;}
      else {this.tables.tdd_branch.push({ name: values[0], fork_commit_sha: values[1] ?? null });}
      return { rows: [] };
    }
    if (/INSERT INTO tdd_commit/i.test(text)) {
      const row = {
        sha: values[0], parent_sha: values[1] ?? null, branch: values[2] ?? null,
        author: values[3] ?? null, message: values[4] ?? null, committed_at: values[5] ?? null
      };
      const existing = this.tables.tdd_commit.find((r) => r.sha === row.sha);
      if (existing) {Object.assign(existing, row);} else {this.tables.tdd_commit.push(row);}
      return { rows: [] };
    }
    if (/INSERT INTO tdd_merge/i.test(text)) {
      this.tables.tdd_merge.push({
        id: this.nextMergeId++, source_branch: values[0], target_branch: values[1],
        source_commit_sha: values[2], merge_commit_sha: values[3],
        is_fast_forward: values[4], merged_at: values[5]
      });
      return { rows: [] };
    }
    if (/INSERT INTO tdd_execution/i.test(text)) {
      const row = {
        id: this.nextExecutionId++, commit_sha: values[0] ?? null,
        tests_total: values[1] || 0, tests_passed: values[2] || 0,
        tests_failed: values[3] || 0, executed_at: values[4]
      };
      this.tables.tdd_execution.push(row);
      return { rows: text.includes('RETURNING id') ? [{ id: row.id }] : [] };
    }
    if (/SELECT table_name FROM information_schema/i.test(text)) {
      const names = values.length ? Object.keys(this.tables).filter((name) => name === values[0]) : Object.keys(this.tables);
      return { rows: names.map((table_name) => ({ table_name, name: table_name })) };
    }
    if (/SELECT 1 AS foreign_keys/i.test(text)) {return { rows: [{ foreign_keys: 1 }] };}
    if (/SELECT version FROM tdd_schema_migration/i.test(text)) {return { rows: [...this.tables.tdd_schema_migration] };}
    if (/SELECT (fork_commit_sha|name) FROM tdd_branch/i.test(text)) {
      const rows = this.tables.tdd_branch.filter((r) => r.name === values[0]);
      return { rows: rows.map((r) => text.includes('fork_commit_sha') ? { fork_commit_sha: r.fork_commit_sha } : { name: r.name }) };
    }
    if (/SELECT MAX\(id\)/i.test(text)) {
      const ids = this.tables.tdd_execution.map((r) => r.id);
      return { rows: [{ m: ids.length ? Math.max(...ids) : null }] };
    }
    if (/SELECT COUNT\(\*\).*tdd_execution/i.test(text)) {return { rows: [{ c: this.tables.tdd_execution.length }] };}
    if (/SELECT COUNT\(\*\).*tdd_commit/i.test(text)) {return { rows: [{ c: this.tables.tdd_commit.length }] };}
    if (/SELECT \* FROM tdd_execution WHERE id/i.test(text)) {
      return { rows: this.tables.tdd_execution.filter((r) => r.id === values[0]) };
    }
    if (/SELECT \* FROM tdd_execution WHERE commit_sha/i.test(text)) {
      return { rows: this.tables.tdd_execution.filter((r) => r.commit_sha === values[0]).sort((a, b) => String(b.executed_at).localeCompare(String(a.executed_at))) };
    }
    if (/SELECT \* FROM tdd_execution ORDER BY executed_at/i.test(text)) {
      return { rows: [...this.tables.tdd_execution].sort((a, b) => String(b.executed_at).localeCompare(String(a.executed_at))) };
    }
    if (/SELECT \* FROM tdd_execution ORDER BY id DESC/i.test(text)) {
      return { rows: [...this.tables.tdd_execution].sort((a, b) => b.id - a.id).slice(0, 1) };
    }
    if (/SELECT \* FROM tdd_commit WHERE sha/i.test(text)) {return { rows: this.tables.tdd_commit.filter((r) => r.sha === values[0]) };}
    if (/SELECT \* FROM tdd_branch WHERE name/i.test(text)) {return { rows: this.tables.tdd_branch.filter((r) => r.name === values[0]) };}
    if (/SELECT \* FROM tdd_merge ORDER BY/i.test(text)) {return { rows: [...this.tables.tdd_merge].sort((a, b) => String(b.merged_at).localeCompare(String(a.merged_at))) };}
    if (/SELECT \* FROM tdd_execution/i.test(text)) {return { rows: [...this.tables.tdd_execution] };}
    throw new Error(`MockPool does not support query: ${text}`);
  }

  async end() {
    this.closed = true;
  }

  async connect() {
    const snapshot = JSON.parse(JSON.stringify(this.tables));
    let active = true;
    return {
      query: async (sql, values = []) => {
        const text = sql.replace(/\s+/g, ' ').trim();
        if (/^ROLLBACK$/i.test(text)) {
          this.tables = JSON.parse(JSON.stringify(snapshot));
          active = false;
          return { rows: [] };
        }
        if (/^COMMIT$/i.test(text)) {
          active = false;
          return { rows: [] };
        }
        if (!active) {
          throw new Error('Transaction is no longer active');
        }
        return this.query(sql, values);
      },
      release: () => {}
    };
  }
}

export function makePool() {
  process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://mock/test';
  return new MockPool();
}
