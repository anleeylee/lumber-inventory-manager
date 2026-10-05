#!/usr/bin/env node
/**
 * cli.ts — bfc-inventory: Lumber Inventory Manager CLI.
 *
 * Workflow:  add/import → list/search → project allocate → reserve/allocate
 *            → consume (offcuts re-enter) → reports
 * Try it instantly with:  bfc-inventory demo
 */

import { Command } from 'commander';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatInches, parseDimension, parseThickness } from './core';
import { Store } from './db/store';
import { addItem, editItem, moveItem, archiveItem, setStatus, ITEM_STATUSES } from './features/items';
import { searchItems, parseNaturalQuery, naturalQueryToFilter, ItemFilter } from './features/search';
import { createProject, ensureProject, listProjects, projectSummary, reserveItem, allocateItem, releaseItem, allocationsForProject } from './features/allocate';
import { consumeItem, scrapItem, sellItem } from './features/consume';
import { runReport, ReportName } from './features/reports';
import { importInventoryFile, exportItemsCSV, itemsToCSVRows } from './features/import';
import { writeCSV } from './features/io';

const program = new Command();
program.name('bfc-inventory').description('Offline lumber inventory database with a full transaction ledger.').version('1.0.0');

function openStore(dbPath: string): Store {
  return new Store(dbPath);
}

function itemTable(rows: import('./db/store').ItemRow[]): void {
  console.table(
    rows.map((i) => ({
      id: i.inventory_id,
      species: i.species,
      t: i.thickness_in,
      w: i.width_in,
      l: i.length_in,
      qty: i.quantity,
      bf: round(i.bf),
      cost: round(i.total_cost),
      loc: i.location,
      status: i.status,
      parent: i.parent_item_id,
    })),
  );
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

program
  .command('add')
  .description('Add an inventory item')
  .argument('<species>', 'species')
  .requiredOption('--t <thickness>', 'thickness (8/4 or inches)')
  .requiredOption('--w <width>', 'width (inches)')
  .requiredOption('--l <length>', 'length (inches/feet)')
  .option('--qty <n>', 'quantity', '1')
  .option('--cost <price>', 'cost per BF')
  .option('--loc <location>', 'location')
  .option('--supplier <name>', 'supplier')
  .option('--date <date>', 'purchase date')
  .option('--id <code>', 'inventory id (default auto)')
  .option('--notes <text>', 'notes')
  .option('--db <path>', 'database path', './inventory.db')
  .action(
    (species: string, opts: { t: string; w: string; l: string; qty: string; cost?: string; loc?: string; supplier?: string; date?: string; id?: string; notes?: string; db: string }) => {
      const store = openStore(opts.db);
      try {
        const item = addItem(store, {
          inventoryId: opts.id,
          species,
          thicknessIn: parseThickness(opts.t).thicknessIn,
          widthIn: parseDimension(opts.w).inches,
          lengthIn: parseDimension(opts.l).inches,
          quantity: Number(opts.qty),
          costPerBF: opts.cost ? Number(opts.cost) : 0,
          location: opts.loc,
          supplier: opts.supplier,
          purchaseDate: opts.date,
          notes: opts.notes,
        });
        console.log(`Added ${item.inventory_id} — ${item.species} ${item.bf.toFixed(2)} BF @ $${item.total_cost.toFixed(2)} (${item.status})`);
      } catch (err) {
        console.error((err as Error).message);
        process.exitCode = 1;
      } finally {
        store.close();
      }
    },
  );

program
  .command('import')
  .description('Receive inventory from CSV/XLSX')
  .argument('<file>', 'inventory file')
  .option('--db <path>', 'database path', './inventory.db')
  .action((file: string, opts: { db: string }) => {
    const store = openStore(opts.db);
    const res = importInventoryFile(store, file);
    for (const w of res.warnings) console.warn(`Warning: ${w}`);
    for (const r of res.rejected) console.warn(`  Rejected row ${r.row}: ${r.reason}`);
    console.log(`Imported ${res.added.length} item(s), rejected ${res.rejected.length}.`);
    store.close();
  });

program
  .command('list')
  .description('List inventory items with filters')
  .option('--species <name>', 'filter by species')
  .option('--status <status>', `filter by status (${ITEM_STATUSES.join('|')})`)
  .option('--loc <location>', 'filter by location')
  .option('--grade <grade>', 'filter by grade')
  .option('--min-l <inches>', 'minimum length')
  .option('--min-w <inches>', 'minimum width')
  .option('--min-bf <n>', 'minimum BF')
  .option('--max <n>', 'maximum rows')
  .option('--db <path>', 'database path', './inventory.db')
  .action((opts: { species?: string; status?: string; loc?: string; grade?: string; minL?: string; minW?: string; minBf?: string; max?: string; db: string }) => {
    const store = openStore(opts.db);
    const filter: ItemFilter = {
      species: opts.species,
      status: opts.status?.toUpperCase(),
      location: opts.loc,
      grade: opts.grade,
      lengthMin: opts.minL ? Number(opts.minL) : undefined,
      widthMin: opts.minW ? Number(opts.minW) : undefined,
      bfMin: opts.minBf ? Number(opts.minBf) : undefined,
    };
    let rows = searchItems(store, filter);
    if (opts.max) rows = rows.slice(0, Number(opts.max));
    console.log(`${rows.length} item(s)`);
    itemTable(rows);
    store.close();
  });

program
  .command('search')
  .description('Natural-language search, e.g. "at least 8/4 x 10 x 72 walnut"')
  .argument('<query>', 'natural query')
  .option('--db <path>', 'database path', './inventory.db')
  .action((query: string, opts: { db: string }) => {
    const store = openStore(opts.db);
    const parsed = parseNaturalQuery(query);
    console.log(
      `Interpreted: ${parsed.species ? `species="${parsed.species}" ` : ''}${parsed.thicknessMin ? `thickness>=${parsed.thicknessMin}" ` : ''}${parsed.widthMin ? `width>=${parsed.widthMin}" ` : ''}${parsed.lengthMin ? `length>=${parsed.lengthMin}" ` : ''}`,
    );
    const rows = searchItems(store, naturalQueryToFilter(parsed));
    console.log(`${rows.length} AVAILABLE item(s)`);
    itemTable(rows);
    store.close();
  });

program
  .command('get')
  .description('Show one item')
  .argument('<id>', 'inventory id')
  .option('--db <path>', 'database path', './inventory.db')
  .action((id: string, opts: { db: string }) => {
    const store = openStore(opts.db);
    const row = store.getItem(id);
    if (!row) {
      console.error(`Item not found: ${id}`);
      process.exitCode = 1;
    } else {
      itemTable([row]);
    }
    store.close();
  });

program
  .command('edit')
  .description('Edit item fields (location, notes, cost, supplier, grade, mc)')
  .argument('<id>', 'inventory id')
  .option('--loc <location>', 'new location')
  .option('--notes <text>', 'new notes')
  .option('--cost <price>', 'new cost per BF')
  .option('--supplier <name>', 'new supplier')
  .option('--grade <grade>', 'new grade')
  .option('--mc <n>', 'moisture content %')
  .option('--db <path>', 'database path', './inventory.db')
  .action(
    (id: string, opts: { loc?: string; notes?: string; cost?: string; supplier?: string; grade?: string; mc?: string; db: string }) => {
      const store = openStore(opts.db);
      try {
        const row = editItem(store, id, {
          location: opts.loc,
          notes: opts.notes,
          costPerBF: opts.cost ? Number(opts.cost) : undefined,
          supplier: opts.supplier,
          grade: opts.grade,
          moistureContent: opts.mc ? Number(opts.mc) : undefined,
        });
        console.log(`Updated ${row.inventory_id} (${row.location}, $${row.total_cost.toFixed(2)})`);
      } catch (err) {
        console.error((err as Error).message);
        process.exitCode = 1;
      } finally {
        store.close();
      }
    },
  );

program
  .command('move')
  .description('Move an item to a new location')
  .argument('<id>', 'inventory id')
  .argument('<location>', 'target location')
  .option('--db <path>', 'database path', './inventory.db')
  .action((id: string, location: string, opts: { db: string }) => {
    const store = openStore(opts.db);
    try {
      const row = moveItem(store, id, location);
      console.log(`Moved ${row.inventory_id} -> ${row.location}`);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    } finally {
      store.close();
    }
  });

program
  .command('project')
  .description('Manage projects: add, list, summary')
  .argument('<action>', 'add | list | summary')
  .option('--name <name>', 'project name')
  .option('--id <id>', 'project id')
  .option('--customer <name>', 'customer')
  .option('--required-bf <n>', 'manual required BF for summary')
  .option('--db <path>', 'database path', './inventory.db')
  .action((action: string, opts: { name?: string; id?: string; customer?: string; requiredBf?: string; db: string }) => {
    const store = openStore(opts.db);
    if (action === 'add') {
      const id = opts.id ?? createProject(store, opts.name ?? 'Untitled', opts.customer ?? '');
      ensureProject(store, id, opts.name);
      console.log(`Project ${id} ready (${opts.name ?? id})`);
    } else if (action === 'list') {
      const rows = listProjects(store);
      console.table(rows.length ? rows : [{ project_id: '(none)', name: '', customer: '' }]);
    } else if (action === 'summary') {
      if (!opts.id) {
        console.error('--id required for summary');
        process.exitCode = 1;
        store.close();
        return;
      }
      const required = opts.requiredBf
        ? []
        : [];
      const summary = projectSummary(store, opts.id, required);
      console.log(`Project ${summary.projectId}:`);
      console.log(`  Required BF: ${summary.requiredBF.toFixed(2)}`);
      console.log(`  Available matching BF: ${summary.availableMatchingBF.toFixed(2)}`);
      console.log(`  Shortfall: ${summary.shortfallBF.toFixed(2)}`);
      console.log(`  Reserved BF (all projects): ${summary.reservedBF.toFixed(2)}`);
      if (summary.matchedItems.length > 0) {
        console.log('  Matching AVAILABLE items:');
        for (const m of summary.matchedItems) {
          console.log(`    ${m.inventoryId} ${m.species} ${m.thicknessIn}"×${m.widthIn}"×${m.lengthIn}" ${m.bf.toFixed(2)} BF`);
        }
      }
    } else {
      console.error(`Unknown action "${action}" (use add | list | summary)`);
      process.exitCode = 1;
    }
    store.close();
  });

program
  .command('reserve')
  .description('Reserve an AVAILABLE item for a project')
  .argument('<id>', 'inventory id')
  .requiredOption('--project <id>', 'project id')
  .option('--db <path>', 'database path', './inventory.db')
  .action((id: string, opts: { project: string; db: string }) => {
    const store = openStore(opts.db);
    try {
      reserveItem(store, id, opts.project);
      console.log(`Reserved ${id} for ${opts.project}`);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    } finally {
      store.close();
    }
  });

program
  .command('allocate')
  .description('Allocate an item (AVAILABLE or RESERVED) to a project')
  .argument('<id>', 'inventory id')
  .requiredOption('--project <id>', 'project id')
  .option('--db <path>', 'database path', './inventory.db')
  .action((id: string, opts: { project: string; db: string }) => {
    const store = openStore(opts.db);
    try {
      allocateItem(store, id, opts.project);
      console.log(`Allocated ${id} to ${opts.project}`);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    } finally {
      store.close();
    }
  });

program
  .command('release')
  .description('Release a RESERVED/ALLOCATED item back to AVAILABLE')
  .argument('<id>', 'inventory id')
  .option('--project <id>', 'project id (auto-detected if omitted)')
  .option('--db <path>', 'database path', './inventory.db')
  .action((id: string, opts: { project?: string; db: string }) => {
    const store = openStore(opts.db);
    try {
      releaseItem(store, id, opts.project);
      console.log(`Released ${id}`);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    } finally {
      store.close();
    }
  });

program
  .command('allocations')
  .description('List allocations for a project')
  .requiredOption('--project <id>', 'project id')
  .option('--db <path>', 'database path', './inventory.db')
  .action((opts: { project: string; db: string }) => {
    const store = openStore(opts.db);
    const rows = allocationsForProject(store, opts.project);
    console.table(rows.length ? rows : [{ item_id: '(none)', status: '', reason: '' }]);
    store.close();
  });

program
  .command('consume')
  .description('Consume a portion of a board; the remaining length becomes an offcut')
  .argument('<id>', 'inventory id')
  .requiredOption('--used-l <inches>', 'length consumed (inches)')
  .option('--project <id>', 'project id')
  .option('--reason <text>', 'reason')
  .option('--min-offcut <inches>', 'minimum offcut length to keep', '12')
  .option('--db <path>', 'database path', './inventory.db')
  .action((id: string, opts: { usedL: string; project?: string; reason?: string; minOffcut: string; db: string }) => {
    const store = openStore(opts.db);
    try {
      const res = consumeItem(store, id, Number(opts.usedL), {
        projectId: opts.project,
        reason: opts.reason,
        minOffcutLengthIn: Number(opts.minOffcut),
      });
      console.log(`Consumed ${id}: ${res.usedBF.toFixed(2)} BF used`);
      if (res.offcutInventoryId) {
        console.log(`  Offcut ${res.offcutInventoryId} created (${res.offcutBF.toFixed(2)} BF) and re-entered stock`);
      } else if (res.scrapReason) {
        console.log(`  Remaining ${res.scrapBF.toFixed(2)} BF scrapped (${res.scrapReason})`);
      } else {
        console.log('  Board fully consumed');
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    } finally {
      store.close();
    }
  });

program
  .command('scrap')
  .description('Scrap an item (or part of it)')
  .argument('<id>', 'inventory id')
  .requiredOption('--reason <text>', 'scrap reason (defect, wrong cut, damage, unusable offcut, moisture, customer rejection)')
  .option('--bf <n>', 'scrap BF (default whole item)')
  .option('--project <id>', 'project id')
  .option('--db <path>', 'database path', './inventory.db')
  .action((id: string, opts: { reason: string; bf?: string; project?: string; db: string }) => {
    const store = openStore(opts.db);
    try {
      scrapItem(store, id, opts.reason, { projectId: opts.project, scrapBF: opts.bf ? Number(opts.bf) : undefined });
      console.log(`Scrapped ${id} (${opts.reason})`);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    } finally {
      store.close();
    }
  });

program
  .command('sell')
  .description('Mark an AVAILABLE item as SOLD')
  .argument('<id>', 'inventory id')
  .option('--db <path>', 'database path', './inventory.db')
  .action((id: string, opts: { db: string }) => {
    const store = openStore(opts.db);
    try {
      sellItem(store, id);
      console.log(`Sold ${id}`);
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    } finally {
      store.close();
    }
  });

program
  .command('report')
  .description('Run an inventory report (valuation | species | location | consumption | project | scrap | suppliers)')
  .argument('<name>', 'report name')
  .option('--project <id>', 'project id (for project report)')
  .option('--csv <file>', 'write CSV output')
  .option('--db <path>', 'database path', './inventory.db')
  .action((name: string, opts: { project?: string; csv?: string; db: string }) => {
    const store = openStore(opts.db);
    try {
      const report = runReport(store, name as ReportName, opts.project);
      console.log(`== ${report.title} ==`);
      console.table(report.rows);
      if (opts.csv) {
        writeCSV(opts.csv, [report.headers, ...report.rows]);
        console.log(`CSV written to ${opts.csv}`);
      }
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    } finally {
      store.close();
    }
  });

program
  .command('export')
  .description('Export current inventory to CSV/XLSX')
  .option('--status <status>', 'filter by status')
  .option('--db <path>', 'database path', './inventory.db')
  .requiredOption('--out <file>', 'output path')
  .action((opts: { status?: string; db: string; out: string }) => {
    const store = openStore(opts.db);
    const rows = searchItems(store, { status: opts.status?.toUpperCase() });
    exportItemsCSV(opts.out, rows);
    console.log(`Exported ${rows.length} item(s) to ${opts.out}`);
    store.close();
  });

program
  .command('demo')
  .description('Create a demo database in ./demo and run the full workflow')
  .action(() => {
    const dir = join(process.cwd(), 'demo');
    mkdirSync(dir, { recursive: true });
    const dbPath = join(dir, 'inventory.db');
    // A demo always starts from a clean database so re-runs are reproducible.
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    const store = openStore(dbPath);

    addItem(store, { species: 'Black Walnut', grade: 'FAS', thicknessIn: 2, widthIn: 10, lengthIn: 72, costPerBF: 12.5, supplier: 'Dealer A', location: 'Rack A', purchaseDate: '2026-01-10' });
    addItem(store, { species: 'Black Walnut', grade: 'FAS', thicknessIn: 2, widthIn: 8, lengthIn: 60, costPerBF: 12.5, supplier: 'Dealer A', location: 'Rack A', purchaseDate: '2026-01-10' });
    addItem(store, { species: 'Red Oak', grade: 'FAS', thicknessIn: 1, widthIn: 8, lengthIn: 96, costPerBF: 7.5, supplier: 'Dealer B', location: 'Rack B', purchaseDate: '2026-02-01' });
    addItem(store, { species: 'Red Oak', grade: 'FAS', thicknessIn: 1, widthIn: 6, lengthIn: 48, costPerBF: 7.5, supplier: 'Dealer B', location: 'Rack B', purchaseDate: '2026-02-01' });
    addItem(store, { species: 'Hard Maple', grade: 'FAS', thicknessIn: 1.5, widthIn: 12, lengthIn: 84, costPerBF: 9.0, supplier: 'Dealer C', location: 'Rack C', purchaseDate: '2026-02-15' });

    const projectId = createProject(store, 'Demo Sideboard', 'Sample Customer');
    reserveItem(store, 'INV-001', projectId);
    allocateItem(store, 'INV-001', projectId);
    consumeItem(store, 'INV-001', 30, { projectId, reason: 'sides' });

    console.log(`Demo database created at ${dbPath}`);
    console.log(`Project: ${projectId}`);
    console.log('');
    itemTable(searchItems(store, {}));
    console.log('');
    console.log('Reports:');
    for (const name of ['valuation', 'species', 'location', 'scrap', 'suppliers'] as ReportName[]) {
      const report = runReport(store, name);
      console.log(`  ${report.title}: ${report.rows.length} row(s)`);
    }
    console.log('');
    console.log('Natural search "at least 8/4 x 10 x 60 walnut":');
    const parsed = parseNaturalQuery('at least 8/4 x 10 x 60 walnut');
    itemTable(searchItems(store, naturalQueryToFilter(parsed)));
    store.close();
  });

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});

export { openStore, itemTable };
