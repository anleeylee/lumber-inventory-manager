/**
 * allocate.ts — Project allocation: reserve, allocate, release.
 *
 * Status flow: AVAILABLE → RESERVED → ALLOCATED → (CUT/CONSUMED).
 * The system computes Required BF / Available Matching BF / Shortfall /
 * Potential Waste for a project before anything is reserved.
 */

import { boardFootInches } from '../core';
import { Store, InventoryError } from '../db/store';
import { assertStatus, setStatus } from './items';
import { searchItems, ItemFilter } from './search';

export interface ProjectSummary {
  projectId: string;
  requiredBF: number;
  availableMatchingBF: number;
  shortfallBF: number;
  reservedBF: number;
  allocatedBF: number;
  matchedItems: { inventoryId: string; species: string; thicknessIn: number; widthIn: number; lengthIn: number; bf: number; status: string }[];
}

export function ensureProject(store: Store, projectId: string, name?: string): void {
  const existing = store.prepare('SELECT project_id FROM projects WHERE project_id = ?').get(projectId);
  if (existing) return;
  store
    .prepare('INSERT INTO projects (project_id, name, customer, created_at) VALUES (?, ?, ?, ?)')
    .run(projectId, name ?? projectId, '', store.now());
}

export function createProject(store: Store, name: string, customer = ''): string {
  const projectId = store.nextProjectId();
  store.prepare('INSERT INTO projects (project_id, name, customer, created_at) VALUES (?, ?, ?, ?)').run(projectId, name, customer, store.now());
  return projectId;
}

export function listProjects(store: Store): { project_id: string; name: string; customer: string }[] {
  return store.prepare('SELECT project_id, name, customer FROM projects ORDER BY id').all() as unknown as {
    project_id: string;
    name: string;
    customer: string;
  }[];
}

export interface RequiredItem {
  species: string;
  thicknessIn: number;
  widthIn: number;
  lengthIn: number;
  quantity: number;
}

/**
 * Compute a project material summary: required BF, available matching BF
 * (AVAILABLE items of the right species + thickness quarter), shortfall and
 * the matching items that would be used.
 */
export function projectSummary(store: Store, projectId: string, required: RequiredItem[]): ProjectSummary {
  const requiredBF = required.reduce((s, r) => s + boardFootInches(r) * r.quantity, 0);

  const matched: ProjectSummary['matchedItems'] = [];
  let availableMatchingBF = 0;
  for (const req of required) {
    const filter: ItemFilter = { species: req.species, status: 'AVAILABLE', includeArchived: false };
    const quarter = Math.round(req.thicknessIn * 4);
    const candidates = searchItems(store, filter).filter((i) => Math.round(i.thickness_in * 4) === quarter);
    for (const c of candidates) {
      matched.push({
        inventoryId: c.inventory_id,
        species: c.species,
        thicknessIn: c.thickness_in,
        widthIn: c.width_in,
        lengthIn: c.length_in,
        bf: c.bf,
        status: c.status,
      });
      availableMatchingBF += c.bf;
    }
  }

  const reserved = store
    .prepare("SELECT COALESCE(SUM(bf),0) AS v FROM inventory_items WHERE status IN ('RESERVED','ALLOCATED') AND archived = 0")
    .get() as { v: number };
  const allocated = store
    .prepare("SELECT COALESCE(SUM(bf),0) AS v FROM inventory_items WHERE status = 'ALLOCATED' AND archived = 0")
    .get() as { v: number };

  return {
    projectId,
    requiredBF,
    availableMatchingBF,
    shortfallBF: Math.max(0, requiredBF - availableMatchingBF),
    reservedBF: reserved.v,
    allocatedBF: allocated.v,
    matchedItems: matched,
  };
}

export function reserveItem(store: Store, inventoryId: string, projectId: string, reason = ''): void {
  const row = store.getItem(inventoryId);
  if (!row) throw new InventoryError(`Item not found: ${inventoryId}`);
  assertStatus(row, ['AVAILABLE']);
  ensureProject(store, projectId);
  store.inTransaction(() => {
    store
      .prepare('INSERT INTO allocations (item_id, project_id, status, reason, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(inventoryId, projectId, 'RESERVED', reason, store.now());
    setStatus(store, inventoryId, 'RESERVED', `reserved for ${projectId}`, projectId);
  });
}

export function allocateItem(store: Store, inventoryId: string, projectId: string, reason = ''): void {
  const row = store.getItem(inventoryId);
  if (!row) throw new InventoryError(`Item not found: ${inventoryId}`);
  assertStatus(row, ['AVAILABLE', 'RESERVED']);
  ensureProject(store, projectId);
  store.inTransaction(() => {
    store
      .prepare('INSERT INTO allocations (item_id, project_id, status, reason, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(inventoryId, projectId, 'ALLOCATED', reason, store.now());
    setStatus(store, inventoryId, 'ALLOCATED', `allocated to ${projectId}`, projectId);
  });
}

export function releaseItem(store: Store, inventoryId: string, projectId?: string, reason = ''): void {
  const row = store.getItem(inventoryId);
  if (!row) throw new InventoryError(`Item not found: ${inventoryId}`);
  if (row.status !== 'RESERVED' && row.status !== 'ALLOCATED') {
    throw new InventoryError(`Item ${inventoryId} is ${row.status}; only RESERVED/ALLOCATED items can be released`);
  }
  let allocationProject = projectId;
  if (!allocationProject) {
    const alloc = store
      .prepare("SELECT project_id FROM allocations WHERE item_id = ? AND status IN ('RESERVED','ALLOCATED') ORDER BY id DESC LIMIT 1")
      .get(inventoryId) as { project_id: string } | undefined;
    allocationProject = alloc?.project_id ?? '';
  }
  store.inTransaction(() => {
    store.prepare("UPDATE allocations SET status = 'RELEASED', reason = ? WHERE item_id = ? AND status IN ('RESERVED','ALLOCATED')").run(reason || 'released', inventoryId);
    setStatus(store, inventoryId, 'AVAILABLE', `released from ${allocationProject}`, allocationProject);
  });
}

export function allocationsForProject(store: Store, projectId: string): { item_id: string; status: string; reason: string }[] {
  return store
    .prepare("SELECT item_id, status, reason FROM allocations WHERE project_id = ? AND status IN ('RESERVED','ALLOCATED') ORDER BY id")
    .all(projectId) as unknown as { item_id: string; status: string; reason: string }[];
}
