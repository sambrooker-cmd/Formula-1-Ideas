// A thin wrapper over Node's built-in SQLite (node:sqlite) with the few conveniences
// this app uses. Built in means nothing to compile on install: no Python, no Xcode tools.
import { createRequire } from 'node:module';
import type { DatabaseSync, StatementSync } from 'node:sqlite';

// node:sqlite prints an "experimental feature" warning on load; it works fine, so hide just that one.
const defaultWarning = process.listeners('warning');
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return;
  for (const l of defaultWarning) l.call(process, w);
});
const { DatabaseSync: Sqlite } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

type Param = string | number | bigint | null | Uint8Array;
const clean = (params: unknown[]): Param[] =>
  params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : (p as Param)));

class Statement {
  constructor(private readonly db: DatabaseSync, private readonly sql: string, private readonly stmt: StatementSync) {}
  run(...params: unknown[]) {
    return this.stmt.run(...clean(params));
  }
  get(...params: unknown[]): unknown {
    return this.stmt.get(...clean(params));
  }
  all(...params: unknown[]): unknown[] {
    return this.stmt.all(...clean(params));
  }
  /** Rows as arrays (column order) instead of objects. */
  raw() {
    const stmt = this.db.prepare(this.sql);
    stmt.setReturnArrays(true);
    return { all: (...params: unknown[]) => stmt.all(...clean(params)) as unknown as unknown[][] };
  }
}

export default class Database {
  private readonly db: DatabaseSync;
  constructor(file: string, opts: { readonly?: boolean } = {}) {
    this.db = new Sqlite(file, { readOnly: !!opts.readonly });
  }
  get open() {
    return this.db.isOpen;
  }
  prepare(sql: string) {
    return new Statement(this.db, sql, this.db.prepare(sql));
  }
  exec(sql: string) {
    this.db.exec(sql);
  }
  pragma(setting: string) {
    this.db.exec(`PRAGMA ${setting}`);
  }
  /** Wrap fn in BEGIN/COMMIT (ROLLBACK on error), like better-sqlite3's transaction(). */
  transaction(fn: () => void) {
    return () => {
      this.db.exec('BEGIN');
      try {
        fn();
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    };
  }
  close() {
    this.db.close();
  }
}
