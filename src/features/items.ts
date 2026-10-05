/**
 * items.ts — Inventory item CRUD. Every mutation records a ledger entry.
 */

import { boardFootInches, parseDimension, parseThickness } from '../core';
import { Store, InventoryError, ItemRow } from '../db/store';
import { ItemStatus, ITEM_STATUSES, LedgerAction } from '../db/schema';

export interface NewItemInput {
  inventoryId?: string;
  species: string;
  scientificName?: string;
  grade?: string;
  thicknessIn: number;
  widthIn: number;
  lengthIn: number;
  quantity?: number;
  costPerBF?: number;
  totalCost?: number;
  supplier?: string;
  purchaseDate?: string;
  location?: string;
  moistureContent?: number;
  grain?: string;
  status?: ItemStatus;
  notes?: string;
  parentItemId?: string;
}

export function addItem(store: Store, input: NewItemInput): ItemRow {
  const species = input.species.trim();
  if (!species) throw new InventoryError('Species is required');
  if (!(input.thicknessIn > 0) || !(input.widthIn > 0) || !(input.lengthIn > 0)) {
    throw new InventoryError('Dimensions must be positive');
  }
  const quantity = input.quantity ?? 1;
  if (!(quantity > 0)) throw new InventoryError('Quantity must be positive');

  const bf = boardFootInches({ thicknessIn: input.thicknessIn, widthIn: input.widthIn, lengthIn: input.lengthIn }) * quantity;
  const costPerBF = input.costPerBF ?? 0;
  const totalCost = input.totalCost ?? bf * costPerBF;

  const inventoryId = input.inventoryId ?? store.nextInventoryId();
  const now = store.now();

  const row = store.inTransaction(() => {
    store.prepare(
      `INSERT INTO inventory_items
        (inventory_id, species, scientific_name, grade, thickness_in, width_in, length_in, quantity, bf,
         cost_per_bf, total_cost, supplier, purchase_date, location, moisture_content, grain, status, notes,
         parent_item_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      inventoryId,
      species,
      input.scientificName ?? '',
      input.grade ?? '',
      input.thicknessIn,
      input.widthIn,
      input.lengthIn,
      quantity,
      bf,
      costPerBF,
      totalCost,
      input.supplier ?? '',
      input.purchaseDate ?? '',
      input.location ?? '',
      input.moistureContent ?? 12,
      input.grain ?? 'any',
      input.status ?? 'AVAILABLE',
      input.notes ?? '',
      input.parentItemId ?? '',
      now,
      now,
    );
    return store.getItem(inventoryId)!;
  });

  store.upsertSupplier(input.supplier ?? '');
  store.upsertLocation(input.location ?? '');
  store.ledger({ action: 'ADD', itemId: inventoryId, newJson: store.itemJson(row), reason: 'receiving' });
  return row;
}

export function assertStatus(row: ItemRow, allowed: ItemStatus[]): void {
  if (!allowed.includes(row.status as ItemStatus)) {
    throw new InventoryError(`Item ${row.inventory_id} is ${row.status}; expected ${allowed.join(' or ')}`);
  }
}

/** Change an item's status, guarded and ledgered. */
export function setStatus(
  store: Store,
  inventoryId: string,
  status: ItemStatus,
  reason: string,
  projectId?: string,
): ItemRow {
  const row = store.getItem(inventoryId);
  if (!row) throw new InventoryError(`Item not found: ${inventoryId}`);
  if (row.status === status) return row;
  const prev = store.itemJson(row);
  const now = store.now();
  store.prepare('UPDATE inventory_items SET status = ?, updated_at = ? WHERE inventory_id = ?').run(status, now, inventoryId);
  const updated = store.getItem(inventoryId)!;
  const action = (status === 'RESERVED' ? 'RESERVE' : status === 'ALLOCATED' ? 'ALLOCATE' : status === 'SCRAP' ? 'SCRAP' : status === 'SOLD' ? 'SELL' : 'EDIT') as LedgerAction;
  store.ledger({ action, itemId: inventoryId, projectId, prevJson: prev, newJson: store.itemJson(updated), reason });
  return updated;
}

export interface EditInput {
  location?: string;
  notes?: string;
  costPerBF?: number;
  supplier?: string;
  grain?: string;
  moistureContent?: number;
  grade?: string;
  quantity?: number;
}

/** Edit non-dimension fields (dimension changes go through consume/offcut). */
export function editItem(store: Store, inventoryId: string, changes: EditInput): ItemRow {
  const row = store.getItem(inventoryId);
  if (!row) throw new InventoryError(`Item not found: ${inventoryId}`);
  const prev = store.itemJson(row);
  const now = store.now();
  const sets: string[] = [];
  const values: (string | number)[] = [];
  if (changes.location !== undefined) {
    sets.push('location = ?');
    values.push(changes.location);
    store.upsertLocation(changes.location);
  }
  if (changes.notes !== undefined) {
    sets.push('notes = ?');
    values.push(changes.notes);
  }
  if (changes.costPerBF !== undefined) {
    sets.push('cost_per_bf = ?');
    values.push(changes.costPerBF);
    sets.push('total_cost = ?');
    values.push(row.bf * changes.costPerBF);
  }
  if (changes.supplier !== undefined) {
    sets.push('supplier = ?');
    values.push(changes.supplier);
    store.upsertSupplier(changes.supplier);
  }
  if (changes.grain !== undefined) {
    sets.push('grain = ?');
    values.push(changes.grain);
  }
  if (changes.moistureContent !== undefined) {
    sets.push('moisture_content = ?');
    values.push(changes.moistureContent);
  }
  if (changes.grade !== undefined) {
    sets.push('grade = ?');
    values.push(changes.grade);
  }
  if (changes.quantity !== undefined) {
    if (!(changes.quantity > 0)) throw new InventoryError('Quantity must be positive');
    sets.push('quantity = ?');
    values.push(changes.quantity);
    sets.push('bf = ?');
    values.push(row.thickness_in * row.width_in * row.length_in / 144 * changes.quantity);
  }
  if (sets.length === 0) return row;
  sets.push('updated_at = ?');
  values.push(now);
  values.push(inventoryId);
  store.prepare(`UPDATE inventory_items SET ${sets.join(', ')} WHERE inventory_id = ?`).run(...values);
  const updated = store.getItem(inventoryId)!;
  store.ledger({ action: 'EDIT', itemId: inventoryId, prevJson: prev, newJson: store.itemJson(updated), reason: 'edit' });
  return updated;
}

/** Move an item between locations (MOVE ledger action). */
export function moveItem(store: Store, inventoryId: string, location: string): ItemRow {
  const row = store.getItem(inventoryId);
  if (!row) throw new InventoryError(`Item not found: ${inventoryId}`);
  const prev = store.itemJson(row);
  const now = store.now();
  store.prepare('UPDATE inventory_items SET location = ?, updated_at = ? WHERE inventory_id = ?').run(location, now, inventoryId);
  const updated = store.getItem(inventoryId)!;
  store.upsertLocation(location);
  store.ledger({ action: 'MOVE', itemId: inventoryId, prevJson: prev, newJson: store.itemJson(updated), reason: `moved to ${location}` });
  return updated;
}

/** Archive an item (soft delete keeps the ledger intact). */
export function archiveItem(store: Store, inventoryId: string): void {
  const row = store.getItem(inventoryId);
  if (!row) throw new InventoryError(`Item not found: ${inventoryId}`);
  const prev = store.itemJson(row);
  store.prepare('UPDATE inventory_items SET archived = 1, updated_at = ? WHERE inventory_id = ?').run(store.now(), inventoryId);
  store.ledger({ action: 'EDIT', itemId: inventoryId, prevJson: prev, newJson: store.itemJson(store.getItemIncludingArchived(inventoryId)), reason: 'archived' });
}

export { ITEM_STATUSES };

/** Parse a dimension cell for inventory imports (accepts 8/4, 1.5, 96 etc.). */
export function parseItemDimension(text: string, kind: 'thickness' | 'width' | 'length'): number {
  if (kind === 'thickness') return parseThickness(text).thicknessIn;
  return parseDimension(text).inches;
}
