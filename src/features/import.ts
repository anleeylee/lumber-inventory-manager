/**
 * import.ts — Inventory receiving from CSV/XLSX.
 */

import {
  mapHeaders,
  parseDecimal,
  cell,
} from '../core';
import { readTableFile, writeCSV } from './io';
import { Store, ItemRow } from '../db/store';
import { ItemStatus, ITEM_STATUSES } from '../db/schema';
import { addItem, parseItemDimension } from './items';

const INVENTORY_SYNONYMS: Record<string, string[]> = {
  inventoryId: ['inventoryid', 'inventory id', 'id', 'sku', 'code'],
  species: ['species', 'wood', 'material'],
  scientificName: ['scientific name', 'scientific'],
  grade: ['grade', 'select', 'fas'],
  thicknessIn: ['thickness', 'thk', 't'],
  widthIn: ['width', 'wdth', 'w'],
  lengthIn: ['length', 'len', 'l'],
  quantity: ['quantity', 'qty', 'q', 'pieces', 'pcs'],
  costPerBF: ['cost/bf', 'cost per bf', '$/bf', 'price', 'unit price'],
  totalCost: ['total cost', 'cost', 'total'],
  supplier: ['supplier', 'vendor', 'source'],
  purchaseDate: ['purchase date', 'date', 'purchased', 'date received'],
  location: ['location', 'rack', 'bin', 'shelf', 'where'],
  moistureContent: ['mc', 'moisture', 'moisture content'],
  grain: ['grain', 'grain direction'],
  status: ['status', 'state'],
  notes: ['notes', 'note', 'comment'],
};

export interface ImportResult {
  added: ItemRow[];
  rejected: { row: number; reason: string }[];
  warnings: string[];
}

export function importInventoryRows(store: Store, rows: string[][]): ImportResult {
  if (rows.length < 2) return { added: [], rejected: [{ row: 1, reason: 'No data rows' }], warnings: [] };
  const headers = rows[0];
  const { mapping, unmapped } = mapHeaders(headers, INVENTORY_SYNONYMS);
  const warnings: string[] = [];
  for (const f of unmapped) {
    if (['scientificName', 'grade', 'quantity', 'totalCost', 'purchaseDate', 'moistureContent', 'grain', 'status', 'notes', 'inventoryId'].includes(f)) continue;
    warnings.push(`Column not found: "${f}"`);
  }

  const added: ItemRow[] = [];
  const rejected: ImportResult['rejected'] = [];
  rows.slice(1).forEach((raw, idx) => {
    const rowIndex = idx + 2;
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = raw[i] ?? '';
    });
    const species = cell(row, mapping, 'species');
    if (!species) {
      rejected.push({ row: rowIndex, reason: 'Missing species' });
      return;
    }
    const statusRaw = cell(row, mapping, 'status').toUpperCase();
    const status: ItemStatus = ITEM_STATUSES.includes(statusRaw as ItemStatus) ? (statusRaw as ItemStatus) : 'AVAILABLE';
    try {
      const item = addItem(store, {
        inventoryId: cell(row, mapping, 'inventoryId') || undefined,
        species,
        scientificName: cell(row, mapping, 'scientificName'),
        grade: cell(row, mapping, 'grade'),
        thicknessIn: parseItemDimension(cell(row, mapping, 'thicknessIn'), 'thickness'),
        widthIn: parseItemDimension(cell(row, mapping, 'widthIn'), 'width'),
        lengthIn: parseItemDimension(cell(row, mapping, 'lengthIn'), 'length'),
        quantity: parseDecimal(cell(row, mapping, 'quantity')) ?? 1,
        costPerBF: parseDecimal(cell(row, mapping, 'costPerBF')) ?? 0,
        totalCost: parseDecimal(cell(row, mapping, 'totalCost')) ?? undefined,
        supplier: cell(row, mapping, 'supplier'),
        purchaseDate: cell(row, mapping, 'purchaseDate'),
        location: cell(row, mapping, 'location'),
        moistureContent: parseDecimal(cell(row, mapping, 'moistureContent')) ?? 12,
        grain: cell(row, mapping, 'grain') || 'any',
        status,
        notes: cell(row, mapping, 'notes'),
      });
      added.push(item);
    } catch (err) {
      rejected.push({ row: rowIndex, reason: (err as Error).message });
    }
  });
  return { added, rejected, warnings };
}

export function importInventoryFile(store: Store, path: string): ImportResult {
  return importInventoryRows(store, readTableFile(path));
}

export function itemsToCSVRows(items: ItemRow[]): (string | number)[][] {
  const head = ['Inventory ID', 'Species', 'Grade', 'Thickness', 'Width', 'Length', 'Qty', 'BF', 'Cost/BF', 'Total Cost', 'Supplier', 'Location', 'Status'];
  const rows: (string | number)[][] = [head];
  for (const i of items) {
    rows.push([i.inventory_id, i.species, i.grade, i.thickness_in, i.width_in, i.length_in, i.quantity, r2(i.bf), i.cost_per_bf, r2(i.total_cost), i.supplier, i.location, i.status]);
  }
  return rows;
}

export function exportItemsCSV(path: string, items: ItemRow[]): void {
  writeCSV(path, itemsToCSVRows(items));
}

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}
