/**
 * schema.ts — SQLite schema for the lumber inventory manager.
 *
 * All mutations go through a transaction ledger; item state is the material
 * snapshot and the ledger is the audit trail. This keeps history intact and
 * makes negative inventory impossible by construction (quantity is guarded
 * in the application layer before every write).
 */

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS inventory_locations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  parent TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  contact TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_id TEXT NOT NULL UNIQUE,
  species TEXT NOT NULL,
  scientific_name TEXT DEFAULT '',
  grade TEXT DEFAULT '',
  thickness_in REAL NOT NULL,
  width_in REAL NOT NULL,
  length_in REAL NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  bf REAL NOT NULL,
  cost_per_bf REAL DEFAULT 0,
  total_cost REAL DEFAULT 0,
  supplier TEXT DEFAULT '',
  purchase_date TEXT DEFAULT '',
  location TEXT DEFAULT '',
  moisture_content REAL DEFAULT 12,
  grain TEXT DEFAULT 'any',
  status TEXT DEFAULT 'AVAILABLE',
  notes TEXT DEFAULT '',
  parent_item_id TEXT DEFAULT '',
  archived INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  customer TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  action TEXT NOT NULL,
  item_id TEXT DEFAULT '',
  project_id TEXT DEFAULT '',
  user_profile TEXT DEFAULT '',
  prev_json TEXT DEFAULT '',
  new_json TEXT DEFAULT '',
  reason TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS scrap_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id TEXT DEFAULT '',
  scrap_bf REAL NOT NULL,
  reason TEXT NOT NULL,
  project_id TEXT DEFAULT '',
  date TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_status ON inventory_items(status);
CREATE INDEX IF NOT EXISTS idx_items_species ON inventory_items(species);
CREATE INDEX IF NOT EXISTS idx_items_location ON inventory_items(location);
CREATE INDEX IF NOT EXISTS idx_items_parent ON inventory_items(parent_item_id);
CREATE INDEX IF NOT EXISTS idx_tx_item ON transactions(item_id);
`;

export type ItemStatus = 'AVAILABLE' | 'RESERVED' | 'ALLOCATED' | 'CUT' | 'SCRAP' | 'SOLD';
export const ITEM_STATUSES: ItemStatus[] = ['AVAILABLE', 'RESERVED', 'ALLOCATED', 'CUT', 'SCRAP', 'SOLD'];

export type LedgerAction =
  | 'ADD'
  | 'EDIT'
  | 'MOVE'
  | 'RESERVE'
  | 'ALLOCATE'
  | 'RELEASE'
  | 'CONSUME'
  | 'SCRAP'
  | 'SELL'
  | 'OFFCUT'
  | 'IMPORT';
