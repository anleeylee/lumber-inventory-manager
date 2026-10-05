/**
 * search.ts — Inventory search and the natural-language query parser.
 *
 * Supports structured filters plus phrases like
 *   "find boards at least 8/4 × 10 × 72 walnut"
 * which becomes thickness >= 2", width >= 10", length >= 72", species walnut.
 */

import { parseDecimal, parseDimension, parseThickness } from '../core';
import { Store, ItemRow } from '../db/store';

export interface ItemFilter {
  species?: string;
  thicknessMin?: number;
  thicknessMax?: number;
  widthMin?: number;
  widthMax?: number;
  lengthMin?: number;
  lengthMax?: number;
  bfMin?: number;
  bfMax?: number;
  grade?: string;
  location?: string;
  supplier?: string;
  status?: string;
  q?: string;
  includeArchived?: boolean;
}

export function searchItems(store: Store, filter: ItemFilter): ItemRow[] {
  const where: string[] = ['1=1'];
  const params: (string | number)[] = [];
  if (!filter.includeArchived) where.push('archived = 0');
  if (filter.species) {
    where.push('lower(species) LIKE ?');
    params.push(`%${filter.species.toLowerCase()}%`);
  }
  if (filter.thicknessMin !== undefined) {
    where.push('thickness_in >= ?');
    params.push(filter.thicknessMin);
  }
  if (filter.thicknessMax !== undefined) {
    where.push('thickness_in <= ?');
    params.push(filter.thicknessMax);
  }
  if (filter.widthMin !== undefined) {
    where.push('width_in >= ?');
    params.push(filter.widthMin);
  }
  if (filter.lengthMin !== undefined) {
    where.push('length_in >= ?');
    params.push(filter.lengthMin);
  }
  if (filter.lengthMax !== undefined) {
    where.push('length_in <= ?');
    params.push(filter.lengthMax);
  }
  if (filter.bfMin !== undefined) {
    where.push('bf >= ?');
    params.push(filter.bfMin);
  }
  if (filter.grade) {
    where.push('lower(grade) LIKE ?');
    params.push(`%${filter.grade.toLowerCase()}%`);
  }
  if (filter.location) {
    where.push('lower(location) LIKE ?');
    params.push(`%${filter.location.toLowerCase()}%`);
  }
  if (filter.supplier) {
    where.push('lower(supplier) LIKE ?');
    params.push(`%${filter.supplier.toLowerCase()}%`);
  }
  if (filter.status) {
    where.push('status = ?');
    params.push(filter.status.toUpperCase());
  }
  if (filter.q) {
    where.push('(lower(species) LIKE ? OR lower(notes) LIKE ? OR lower(grade) LIKE ? OR lower(inventory_id) LIKE ?)');
    const q = `%${filter.q.toLowerCase()}%`;
    params.push(q, q, q, q);
  }
  const sql = `SELECT * FROM inventory_items WHERE ${where.join(' AND ')} ORDER BY species, length_in DESC`;
  return store.prepare(sql).all(...params) as unknown as ItemRow[];
}

export interface NaturalQuery {
  thicknessMin?: number;
  widthMin?: number;
  lengthMin?: number;
  species?: string;
  raw: string;
}

/**
 * Parse "at least 8/4 × 10 × 72 walnut" style queries.
 * Recognizes a quarter thickness (n/4), up to two ×-separated numbers
 * (width × length), and a trailing species keyword.
 */
export function parseNaturalQuery(text: string): NaturalQuery {
  const raw = text.trim();
  const out: NaturalQuery = { raw };

  const quarter = /(\d+)\s*\/\s*4/.exec(raw);
  if (quarter) out.thicknessMin = Number(quarter[1]) / 4;

  // Numbers for width/length: strip the thickness fraction first so "8/4"
  // never contributes its numerator as a dimension.
  const withoutQuarter = raw.replace(/\d+\s*\/\s*4/g, ' ');
  const numbers = [...withoutQuarter.matchAll(/\d+(?:\.\d+)?/g)]
    .map((m) => Number(m[0]))
    .filter((n) => n > 0);

  // Strip the quarter and pure numbers to find the species word(s).
  const withoutNumbers = withoutQuarter.replace(/\d+(?:\.\d+)?/g, ' ').replace(/[×xX*.,]/g, ' ');
  const words = withoutNumbers.split(/\s+/).filter((w) => w.length >= 2 && !['at', 'least', 'find', 'boards', 'board', 'any'].includes(w.toLowerCase()));
  if (words.length > 0) out.species = words.join(' ');

  // Dimension convention: width × length (the first two plain numbers).
  const dims = numbers.filter((n) => n > 0);
  if (dims.length >= 1) out.widthMin = dims[0];
  if (dims.length >= 2) out.lengthMin = dims[1];
  return out;
}

export function naturalQueryToFilter(query: NaturalQuery): ItemFilter {
  return {
    species: query.species,
    thicknessMin: query.thicknessMin,
    widthMin: query.widthMin,
    lengthMin: query.lengthMin,
    status: 'AVAILABLE',
  };
}
