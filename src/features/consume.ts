/**
 * consume.ts — Inventory consumption and offcut rollback.
 *
 * When a cutting optimizer finishes, a board is partially consumed: the used
 * portion is logged as CONSUME, the original item becomes CUT, and the
 * remaining length re-enters inventory as a new offcut item (linked via
 * parent_item_id). Negative inventory is impossible — used length is
 * validated against the item before any write.
 */

import { boardFootInches } from '../core';
import { Store, InventoryError } from '../db/store';
import { addItem, assertStatus, setStatus } from './items';

export interface ConsumptionResult {
  usedBF: number;
  originalStatus: string;
  offcutInventoryId: string | null;
  offcutBF: number;
  scrapBF: number;
  scrapReason: string | null;
}

export const MIN_OFFCUT_LENGTH_IN = 12;

export function consumeItem(
  store: Store,
  inventoryId: string,
  usedLengthIn: number,
  opts: { projectId?: string; reason?: string; minOffcutLengthIn?: number } = {},
): ConsumptionResult {
  const row = store.getItem(inventoryId);
  if (!row) throw new InventoryError(`Item not found: ${inventoryId}`);
  assertStatus(row, ['AVAILABLE', 'RESERVED', 'ALLOCATED']);
  if (!(usedLengthIn > 0)) throw new InventoryError('Used length must be positive');
  if (usedLengthIn > row.length_in + 1e-9) {
    throw new InventoryError(
      `Cannot consume ${usedLengthIn}" from ${row.inventory_id} (${row.length_in}" long) — would make inventory negative`,
    );
  }

  const minOffcut = opts.minOffcutLengthIn ?? MIN_OFFCUT_LENGTH_IN;
  const usedBF = boardFootInches({ thicknessIn: row.thickness_in, widthIn: row.width_in, lengthIn: usedLengthIn }) * row.quantity;
  const remainingLength = row.length_in - usedLengthIn;

  let offcutInventoryId: string | null = null;
  let offcutBF = 0;
  let scrapBF = 0;
  let scrapReason: string | null = null;

  store.inTransaction(() => {
    if (remainingLength > minOffcut + 1e-9) {
      const offcut = addItem(store, {
        species: row.species,
        scientificName: row.scientific_name,
        grade: row.grade,
        thicknessIn: row.thickness_in,
        widthIn: row.width_in,
        lengthIn: remainingLength,
        quantity: row.quantity,
        costPerBF: row.cost_per_bf,
        supplier: row.supplier,
        purchaseDate: row.purchase_date,
        location: row.location,
        moistureContent: row.moisture_content,
        grain: row.grain,
        status: 'AVAILABLE',
        notes: `Offcut from ${inventoryId}${row.notes ? ` (${row.notes})` : ''}`,
        parentItemId: inventoryId,
      });
      offcutInventoryId = offcut.inventory_id;
      offcutBF = offcut.bf;
    } else if (remainingLength > 1e-9) {
      scrapBF = boardFootInches({ thicknessIn: row.thickness_in, widthIn: row.width_in, lengthIn: remainingLength }) * row.quantity;
      scrapReason = 'unusable offcut';
      store
        .prepare('INSERT INTO scrap_log (item_id, scrap_bf, reason, project_id, date) VALUES (?, ?, ?, ?, ?)')
        .run(inventoryId, scrapBF, scrapReason, opts.projectId ?? '', store.now());
    }
    setStatus(store, inventoryId, 'CUT', `consumed ${usedLengthIn}"${opts.reason ? ` (${opts.reason})` : ''}`, opts.projectId);
  });

  store.ledger({
    action: 'CONSUME',
    itemId: inventoryId,
    projectId: opts.projectId,
    newJson: JSON.stringify({ usedLengthIn, usedBF, offcutInventoryId }),
    reason: opts.reason ?? 'cutting',
  });
  if (offcutInventoryId) {
    store.ledger({ action: 'OFFCUT', itemId: offcutInventoryId, projectId: opts.projectId, reason: `offcut from ${inventoryId}` });
  }

  return {
    usedBF,
    originalStatus: 'CUT',
    offcutInventoryId,
    offcutBF,
    scrapBF,
    scrapReason,
  };
}

export function scrapItem(
  store: Store,
  inventoryId: string,
  reason: string,
  opts: { projectId?: string; scrapBF?: number } = {},
): void {
  const row = store.getItem(inventoryId);
  if (!row) throw new InventoryError(`Item not found: ${inventoryId}`);
  assertStatus(row, ['AVAILABLE', 'RESERVED', 'ALLOCATED']);
  const scrap = opts.scrapBF ?? row.bf;
  if (!(scrap > 0)) throw new InventoryError('Scrap BF must be positive');
  store.inTransaction(() => {
    store
      .prepare('INSERT INTO scrap_log (item_id, scrap_bf, reason, project_id, date) VALUES (?, ?, ?, ?, ?)')
      .run(inventoryId, scrap, reason, opts.projectId ?? '', store.now());
    setStatus(store, inventoryId, 'SCRAP', reason, opts.projectId);
  });
}

export function sellItem(store: Store, inventoryId: string, reason = 'sold'): void {
  const row = store.getItem(inventoryId);
  if (!row) throw new InventoryError(`Item not found: ${inventoryId}`);
  assertStatus(row, ['AVAILABLE']);
  setStatus(store, inventoryId, 'SOLD', reason);
}
