/**
 * reports.ts — Inventory reports.
 *   valuation | species | location | consumption | project | scrap | suppliers
 */

import { Store } from '../db/store';

export type ReportName = 'valuation' | 'species' | 'location' | 'consumption' | 'project' | 'scrap' | 'suppliers';

export interface Report {
  title: string;
  headers: string[];
  rows: (string | number)[][];
}

export function runReport(store: Store, report: ReportName, extra?: string): Report {
  switch (report) {
    case 'valuation':
      return valuation(store);
    case 'species':
      return bySpecies(store);
    case 'location':
      return byLocation(store);
    case 'consumption':
      return consumptionHistory(store);
    case 'project':
      return projectConsumption(store, extra ?? '');
    case 'scrap':
      return scrapReport(store);
    case 'suppliers':
      return supplierHistory(store);
    default:
      throw new Error(`Unknown report: ${report}`);
  }
}

function valuation(store: Store): Report {
  const rows = store
    .prepare(
      `SELECT species, COUNT(*) AS boards, SUM(quantity) AS qty, SUM(bf) AS bf,
              SUM(total_cost) AS cost
       FROM inventory_items WHERE archived = 0 AND status IN ('AVAILABLE','RESERVED','ALLOCATED')
       GROUP BY species ORDER BY cost DESC`,
    )
    .all() as unknown as { species: string; boards: number; qty: number; bf: number; cost: number }[];
  const total = rows.reduce((s, r) => ({ bf: s.bf + r.bf, cost: s.cost + r.cost }), { bf: 0, cost: 0 });
  return {
    title: 'Inventory valuation',
    headers: ['Species', 'Boards', 'Qty', 'BF', 'Estimated Value'],
    rows: [...rows.map((r) => [r.species, r.boards, r.qty, r2(r.bf), r2(r.cost)]), ['TOTAL', '', '', r2(total.bf), r2(total.cost)]],
  };
}

function bySpecies(store: Store): Report {
  const rows = store
    .prepare(
      `SELECT species, COUNT(*) AS boards, SUM(bf) AS bf
       FROM inventory_items WHERE archived = 0 GROUP BY species ORDER BY bf DESC`,
    )
    .all() as unknown as { species: string; boards: number; bf: number }[];
  return {
    title: 'BF by species',
    headers: ['Species', 'Boards', 'BF'],
    rows: rows.map((r) => [r.species, r.boards, r2(r.bf)]),
  };
}

function byLocation(store: Store): Report {
  const rows = store
    .prepare(
      `SELECT location, COUNT(*) AS boards, SUM(bf) AS bf
       FROM inventory_items WHERE archived = 0 GROUP BY location ORDER BY bf DESC`,
    )
    .all() as unknown as { location: string; boards: number; bf: number }[];
  return {
    title: 'BF by location',
    headers: ['Location', 'Boards', 'BF'],
    rows: rows.map((r) => [r.location || '(unassigned)', r.boards, r2(r.bf)]),
  };
}

function consumptionHistory(store: Store): Report {
  const rows = store
    .prepare(
      `SELECT ts, action, item_id, project_id, reason FROM transactions
       WHERE action IN ('CONSUME','SCRAP','SELL') ORDER BY ts DESC LIMIT 200`,
    )
    .all() as unknown as { ts: string; action: string; item_id: string; project_id: string; reason: string }[];
  return {
    title: 'Consumption history',
    headers: ['Timestamp', 'Action', 'Item', 'Project', 'Reason'],
    rows: rows.map((r) => [r.ts, r.action, r.item_id, r.project_id, r.reason]),
  };
}

function projectConsumption(store: Store, projectId: string): Report {
  const where = projectId ? 'AND project_id = ?' : '';
  const params = projectId ? [projectId] : [];
  const rows = store
    .prepare(
      `SELECT project_id, action, COUNT(*) AS n FROM transactions
       WHERE action IN ('RESERVE','ALLOCATE','CONSUME','SCRAP') ${where}
       GROUP BY project_id, action ORDER BY project_id`,
    )
    .all(...params) as unknown as { project_id: string; action: string; n: number }[];
  return {
    title: `Project consumption${projectId ? ` (${projectId})` : ''}`,
    headers: ['Project', 'Action', 'Count'],
    rows: rows.map((r) => [r.project_id || '(none)', r.action, r.n]),
  };
}

function scrapReport(store: Store): Report {
  const rows = store
    .prepare('SELECT date, item_id, scrap_bf, reason, project_id FROM scrap_log ORDER BY date DESC LIMIT 200')
    .all() as unknown as { date: string; item_id: string; scrap_bf: number; reason: string; project_id: string }[];
  const total = rows.reduce((s, r) => s + r.scrap_bf, 0);
  return {
    title: 'Scrap report',
    headers: ['Date', 'Item', 'Scrap BF', 'Reason', 'Project'],
    rows: [...rows.map((r) => [r.date, r.item_id, r2(r.scrap_bf), r.reason, r.project_id]), ['TOTAL', '', r2(total), '', '']],
  };
}

function supplierHistory(store: Store): Report {
  const rows = store
    .prepare(
      `SELECT supplier, COUNT(*) AS purchases, SUM(bf) AS bf, SUM(total_cost) AS cost
       FROM inventory_items WHERE supplier != '' AND archived = 0 GROUP BY supplier ORDER BY cost DESC`,
    )
    .all() as unknown as { supplier: string; purchases: number; bf: number; cost: number }[];
  return {
    title: 'Supplier purchase history',
    headers: ['Supplier', 'Purchases', 'BF', 'Cost'],
    rows: rows.map((r) => [r.supplier, r.purchases, r2(r.bf), r2(r.cost)]),
  };
}

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}
