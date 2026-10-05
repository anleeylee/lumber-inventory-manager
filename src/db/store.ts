/**
 * store.ts — SQLite store wrapper (Node's built-in node:sqlite).
 *
 * Requires Node >= 22.5. All writes that touch item state go through
 * `withLedger`, which records a transaction with the previous and new item
 * JSON so nothing is ever overwritten without a trace.
 *
 * node:sqlite is resolved at runtime via require so test tooling (Vite) never
 * tries to transform the builtin as if it were a file.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';
import { SCHEMA, LedgerAction } from './schema';

export interface ItemRow {
  id: number;
  inventory_id: string;
  species: string;
  scientific_name: string;
  grade: string;
  thickness_in: number;
  width_in: number;
  length_in: number;
  quantity: number;
  bf: number;
  cost_per_bf: number;
  total_cost: number;
  supplier: string;
  purchase_date: string;
  location: string;
  moisture_content: number;
  grain: string;
  status: string;
  notes: string;
  parent_item_id: string;
  archived: number;
  created_at: string;
  updated_at: string;
}

export class InventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryError';
  }
}

export class Store {
  private db: DatabaseSyncType;
  private txDepth = 0;
  readonly path: string;

  constructor(path: string = ':memory:') {
    this.path = path;
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): ReturnType<DatabaseSyncType['prepare']> {
    return this.db.prepare(sql);
  }

  /** Run a block inside a transaction. Nested calls join the outer transaction. */
  inTransaction<T>(fn: () => T): T {
    if (this.txDepth > 0) return fn();
    this.db.exec('BEGIN');
    this.txDepth = 1;
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    } finally {
      this.txDepth = 0;
    }
  }

  now(): string {
    return new Date().toISOString();
  }

  /** Record a ledger entry. */
  ledger(entry: {
    action: LedgerAction;
    itemId?: string;
    projectId?: string;
    prevJson?: string;
    newJson?: string;
    reason?: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO transactions (ts, action, item_id, project_id, user_profile, prev_json, new_json, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.now(),
        entry.action,
        entry.itemId ?? '',
        entry.projectId ?? '',
        process.env.USERPROFILE || process.env.USER || 'local',
        entry.prevJson ?? '',
        entry.newJson ?? '',
        entry.reason ?? '',
      );
  }

  getItem(inventoryId: string): ItemRow | null {
    const row = this.db.prepare('SELECT * FROM inventory_items WHERE inventory_id = ? AND archived = 0').get(inventoryId);
    return row ? (row as unknown as ItemRow) : null;
  }

  getItemIncludingArchived(inventoryId: string): ItemRow | null {
    const row = this.db.prepare('SELECT * FROM inventory_items WHERE inventory_id = ?').get(inventoryId);
    return row ? (row as unknown as ItemRow) : null;
  }

  itemJson(row: ItemRow | null): string {
    return row ? JSON.stringify(row) : '';
  }

  nextInventoryId(): string {
    const row = this.db.prepare('SELECT MAX(id) AS m FROM inventory_items').get() as { m: number | null };
    const n = (row.m ?? 0) + 1;
    return `INV-${String(n).padStart(3, '0')}`;
  }

  nextProjectId(): string {
    const row = this.db.prepare('SELECT MAX(id) AS m FROM projects').get() as { m: number | null };
    const n = (row.m ?? 0) + 1;
    return `PRJ-${String(n).padStart(3, '0')}`;
  }

  upsertSupplier(name: string): void {
    if (!name.trim()) return;
    this.db.prepare('INSERT OR IGNORE INTO suppliers (name) VALUES (?)').run(name.trim());
  }

  upsertLocation(name: string): void {
    if (!name.trim()) return;
    this.db.prepare('INSERT OR IGNORE INTO inventory_locations (name) VALUES (?)').run(name.trim());
  }
}
