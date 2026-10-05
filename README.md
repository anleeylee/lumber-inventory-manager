# bfc-inventory — Lumber Inventory Manager
<!-- bfc-badges -->
<div align="center">

**English** · [简体中文](./docs/README.zh-CN.md)

![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.5-339933?logo=nodedotjs&logoColor=white)
![CLI](https://img.shields.io/badge/CLI-Commander-6F42C1?logo=gnubash&logoColor=white)
![Tests](https://img.shields.io/badge/tests-15%20passed-2ea44f)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)

</div>


An offline-first lumber inventory database with a **full transaction
ledger**. Receive boards, search in plain English, reserve and allocate stock
to projects, consume boards on the saw, and watch every offcut automatically
roll back into inventory. SQLite-backed — negative inventory is impossible by
construction.

Companion guide: [Hardwood Board Foot Calculator](https://boardfootcalc.net/hardwood-board-foot-calculator/) ·
See also [How to Buy Lumber by Board Foot](https://boardfootcalc.net/how-to-buy-lumber-by-board-foot/)
and the [Lumber Size Chart](https://boardfootcalc.net/lumber-size-chart/).

## Features

- **SQLite storage** via Node's built-in `node:sqlite` — zero native
  compilation, one `.db` file per yard.
- **Transaction ledger** — every add / edit / move / reserve / allocate /
  release / consume / scrap / sell writes a ledger entry with the previous and
  next item snapshot. Nothing is ever overwritten without a trace.
- **Natural-language search** — `"find boards at least 8/4 x 10 x 72 walnut"`
  parses to thickness ≥ 2", width ≥ 10", length ≥ 72", species walnut,
  AVAILABLE only.
- **Projects & allocation** — reserve → allocate → release, with Required BF /
  Available Matching BF / Shortfall / Potential Waste computed before you
  commit anything.
- **Consumption & offcuts** — consume a length from a board; the remainder
  re-enters stock as a new offcut item linked to its parent (or is scrapped
  when shorter than the minimum offcut length).
- **Status model** — `AVAILABLE → RESERVED → ALLOCATED → CUT`, plus
  `SCRAP` / `SOLD`, guarded transitions only.
- **Receiving & exports** — CSV/XLSX import with flexible column mapping;
  CSV export of any filtered view.
- **Reports** — valuation, BF by species, BF by location, consumption
  history, project consumption, scrap report, supplier history.

## Requirements

- **Node.js ≥ 22.5** (uses built-in `node:sqlite`).

## Install

```bash
git clone https://github.com/anleeylee/lumber-inventory-manager bfc-inventory
cd bfc-inventory
npm install
npm run build
npm test
```

## Quick start

```bash
npm run demo
# creates ./demo/inventory.db and runs receiving → project → consume → offcut → reports
```

Or:

```bash
# Receive stock
bfc-inventory add "Black Walnut" --t 8/4 --w 10 --l 72 --cost 12.5 --loc "Rack A" --supplier "Dealer A"
bfc-inventory import receiving.csv

# Find boards
bfc-inventory search "at least 8/4 x 10 x 60 walnut"

# Plan a project, then commit
bfc-inventory project add --name "Sideboard"
bfc-inventory reserve INV-001 --project PRJ-001
bfc-inventory allocate INV-001 --project PRJ-001

# Cut: 30" consumed, remainder becomes an offcut
bfc-inventory consume INV-001 --used-l 30 --project PRJ-001 --reason "sides"

# Reports
bfc-inventory report valuation
bfc-inventory report scrap --csv scrap.csv
```

## CLI reference

```
bfc-inventory add <species> --t <thk> --w <width> --l <length> [--qty 1] [--cost $/BF] [--loc <loc>] [--supplier <s>] [--id INV-001] [--db <file>]
bfc-inventory import <file> [--db <file>]
bfc-inventory list [--species <s>] [--status <s>] [--loc <loc>] [--min-l <in>] [--min-w <in>] [--min-bf <n>] [--max <n>] [--db <file>]
bfc-inventory search "<natural query>" [--db <file>]
bfc-inventory get <id> [--db <file>]
bfc-inventory edit <id> [--loc <loc>] [--notes <t>] [--cost <n>] [--supplier <s>] [--grade <g>] [--mc <n>] [--db <file>]
bfc-inventory move <id> <location> [--db <file>]
bfc-inventory project add|list|summary [--name <n>] [--id <id>] [--required-bf <n>] [--db <file>]
bfc-inventory reserve <id> --project <pid> [--db <file>]
bfc-inventory allocate <id> --project <pid> [--db <file>]
bfc-inventory release <id> [--project <pid>] [--db <file>]
bfc-inventory allocations --project <pid> [--db <file>]
bfc-inventory consume <id> --used-l <in> [--project <pid>] [--min-offcut 12] [--db <file>]
bfc-inventory scrap <id> --reason <text> [--bf <n>] [--db <file>]
bfc-inventory sell <id> [--db <file>]
bfc-inventory report valuation|species|location|consumption|project|scrap|suppliers [--csv <file>] [--db <file>]
bfc-inventory export --out <file> [--status <s>] [--db <file>]
bfc-inventory demo
```

Every command accepts `--db <path>` (default `./inventory.db`).

## Receiving CSV format

Headers matched by synonym; rejected rows are reported, never silently
dropped:

| Species | Thickness | Width | Length | Qty | Cost/BF | Supplier | Location | Date |
|---|---|---|---|---|---|---|---|---|
| Black Walnut | 8/4 | 10 | 72 | 1 | 12.5 | Dealer A | Rack A | 2026-01-10 |
| Red Oak | 4/4 | 6 | 96 | 2 | 7.5 | Dealer B | Rack B | |

## Why a ledger?

Every mutation stores the previous and next JSON snapshot. If a board
disappears, the `transactions` table shows exactly which command did it, when,
and why — the audit trail for a workshop that wants to trust its numbers.

## Engine

Frozen copy of the shared
[BoardFootCalc Desktop Lumber Calculation Engine](https://boardfootcalc.net/hardwood-board-foot-calculator/) in `src/core/`
— board foot math, units and thickness parsing match the
[online calculators](https://boardfootcalc.net/hardwood-board-foot-calculator/).

## Tests

```bash
npm test   # items, search, allocation, consumption/offcut, imports, reports
```

## License

MIT. Inventory values are planning estimates — verify against actual stock
and yard pricing.
