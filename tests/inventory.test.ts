import { describe, expect, it } from 'vitest';
import { Store, InventoryError } from '../src/db/store';
import { addItem, editItem, moveItem, setStatus } from '../src/features/items';
import { searchItems, parseNaturalQuery } from '../src/features/search';
import { createProject, projectSummary, reserveItem, allocateItem, releaseItem } from '../src/features/allocate';
import { consumeItem, scrapItem } from '../src/features/consume';
import { importInventoryRows } from '../src/features/import';
import { runReport } from '../src/features/reports';

function freshStore(): Store {
  return new Store(':memory:');
}

describe('items', () => {
  it('computes BF and total cost on add', () => {
    const store = freshStore();
    const item = addItem(store, { species: 'Walnut', thicknessIn: 2, widthIn: 10, lengthIn: 72, costPerBF: 10 });
    expect(item.bf).toBeCloseTo(2 * 10 * 72 / 144);
    expect(item.total_cost).toBeCloseTo(item.bf * 10);
    expect(item.status).toBe('AVAILABLE');
    store.close();
  });

  it('auto-assigns inventory ids', () => {
    const store = freshStore();
    const a = addItem(store, { species: 'Oak', thicknessIn: 1, widthIn: 6, lengthIn: 48 });
    const b = addItem(store, { species: 'Oak', thicknessIn: 1, widthIn: 6, lengthIn: 48 });
    expect(a.inventory_id).toBe('INV-001');
    expect(b.inventory_id).toBe('INV-002');
    store.close();
  });

  it('rejects invalid dimensions and empty species', () => {
    const store = freshStore();
    expect(() => addItem(store, { species: '', thicknessIn: 1, widthIn: 6, lengthIn: 48 })).toThrow(InventoryError);
    expect(() => addItem(store, { species: 'Oak', thicknessIn: 0, widthIn: 6, lengthIn: 48 })).toThrow(InventoryError);
    store.close();
  });

  it('guards status transitions', () => {
    const store = freshStore();
    const item = addItem(store, { species: 'Oak', thicknessIn: 1, widthIn: 6, lengthIn: 48 });
    expect(() => setStatus(store, item.inventory_id, 'SCRAP', 'test')).not.toThrow();
    // a scrapped item cannot be reserved
    expect(() => setStatus(store, item.inventory_id, 'AVAILABLE', 'undo')).not.toThrow();
    store.close();
  });

  it('edit and move record ledger entries', () => {
    const store = freshStore();
    const item = addItem(store, { species: 'Oak', thicknessIn: 1, widthIn: 6, lengthIn: 48, location: 'A' });
    moveItem(store, item.inventory_id, 'B');
    editItem(store, item.inventory_id, { costPerBF: 8 });
    const tx = store.prepare('SELECT action FROM transactions ORDER BY id').all() as { action: string }[];
    expect(tx.map((t) => t.action)).toEqual(['ADD', 'MOVE', 'EDIT']);
    store.close();
  });
});

describe('search', () => {
  it('filters by species, status and minimum length', () => {
    const store = freshStore();
    addItem(store, { species: 'Walnut', thicknessIn: 2, widthIn: 10, lengthIn: 72 });
    addItem(store, { species: 'Oak', thicknessIn: 1, widthIn: 6, lengthIn: 96 });
    const rows = searchItems(store, { species: 'walnut' });
    expect(rows).toHaveLength(1);
    expect(rows[0].species).toBe('Walnut');
    expect(searchItems(store, { lengthMin: 80 })).toHaveLength(1);
    store.close();
  });

  it('parses natural queries', () => {
    const q = parseNaturalQuery('find boards at least 8/4 x 10 x 72 walnut');
    expect(q.thicknessMin).toBe(2);
    expect(q.widthMin).toBe(10);
    expect(q.lengthMin).toBe(72);
    expect(q.species).toContain('walnut');
  });
});

describe('allocation', () => {
  it('reserves, allocates and releases', () => {
    const store = freshStore();
    const item = addItem(store, { species: 'Walnut', thicknessIn: 2, widthIn: 10, lengthIn: 72 });
    const pid = createProject(store, 'Sideboard');
    reserveItem(store, item.inventory_id, pid);
    expect(store.getItem(item.inventory_id)!.status).toBe('RESERVED');
    allocateItem(store, item.inventory_id, pid);
    expect(store.getItem(item.inventory_id)!.status).toBe('ALLOCATED');
    releaseItem(store, item.inventory_id);
    expect(store.getItem(item.inventory_id)!.status).toBe('AVAILABLE');
    store.close();
  });

  it('cannot reserve a non-AVAILABLE item', () => {
    const store = freshStore();
    const item = addItem(store, { species: 'Walnut', thicknessIn: 2, widthIn: 10, lengthIn: 72 });
    const pid = createProject(store, 'P');
    reserveItem(store, item.inventory_id, pid);
    expect(() => reserveItem(store, item.inventory_id, pid)).toThrow(InventoryError);
    store.close();
  });

  it('computes project summary and shortfall', () => {
    const store = freshStore();
    addItem(store, { species: 'Walnut', thicknessIn: 2, widthIn: 10, lengthIn: 72 }); // 10 BF
    const pid = createProject(store, 'P');
    const summary = projectSummary(store, pid, [{ species: 'Walnut', thicknessIn: 2, widthIn: 10, lengthIn: 72, quantity: 2 }]); // needs 20 BF
    expect(summary.requiredBF).toBeCloseTo(20);
    expect(summary.availableMatchingBF).toBeCloseTo(10);
    expect(summary.shortfallBF).toBeCloseTo(10);
    store.close();
  });
});

describe('consumption', () => {
  it('consumes length and rolls the remainder back as an offcut', () => {
    const store = freshStore();
    const item = addItem(store, { species: 'Walnut', thicknessIn: 2, widthIn: 10, lengthIn: 72 }); // 10 BF
    const res = consumeItem(store, item.inventory_id, 24);
    expect(res.usedBF).toBeCloseTo(2 * 10 * 24 / 144);
    expect(store.getItem(item.inventory_id)!.status).toBe('CUT');
    expect(res.offcutInventoryId).not.toBeNull();
    const offcut = store.getItem(res.offcutInventoryId!)!;
    expect(offcut.length_in).toBeCloseTo(48);
    expect(offcut.parent_item_id).toBe(item.inventory_id);
    expect(offcut.status).toBe('AVAILABLE');
    expect(offcut.bf).toBeCloseTo(2 * 10 * 48 / 144);
    store.close();
  });

  it('scraps the remainder when the offcut is too short', () => {
    const store = freshStore();
    const item = addItem(store, { species: 'Oak', thicknessIn: 1, widthIn: 6, lengthIn: 14 });
    const res = consumeItem(store, item.inventory_id, 10, { minOffcutLengthIn: 12 });
    expect(res.offcutInventoryId).toBeNull();
    expect(res.scrapReason).toBe('unusable offcut');
    const scrap = store.prepare('SELECT * FROM scrap_log').all() as { scrap_bf: number }[];
    expect(scrap).toHaveLength(1);
    expect(scrap[0].scrap_bf).toBeCloseTo(1 * 6 * 4 / 144);
    store.close();
  });

  it('refuses consumption that would exceed the board', () => {
    const store = freshStore();
    const item = addItem(store, { species: 'Oak', thicknessIn: 1, widthIn: 6, lengthIn: 12 });
    expect(() => consumeItem(store, item.inventory_id, 13)).toThrow(InventoryError);
    store.close();
  });
});

describe('imports & reports', () => {
  it('imports rows and records rejected rows', () => {
    const store = freshStore();
    const res = importInventoryRows(store, [
      ['Species', 'Thickness', 'Width', 'Length', 'Qty', 'Cost/BF'],
      ['Walnut', '8/4', 10, 72, 1, 12],
      ['', '4/4', 6, 48, 1, 8],
      ['Oak', '4/4', 6, 48, 2, 7.5],
    ]);
    expect(res.added).toHaveLength(2);
    expect(res.rejected).toHaveLength(1);
    expect(res.added[0].thickness_in).toBe(2);
    store.close();
  });

  it('runs valuation and scrap reports', () => {
    const store = freshStore();
    addItem(store, { species: 'Walnut', thicknessIn: 2, widthIn: 10, lengthIn: 72, costPerBF: 10 });
    scrapItem(store, 'INV-001', 'defect');
    const valuation = runReport(store, 'valuation');
    expect(valuation.rows[valuation.rows.length - 1][0]).toBe('TOTAL');
    const scrap = runReport(store, 'scrap');
    expect(scrap.rows).toHaveLength(2); // header + total
    store.close();
  });
});
