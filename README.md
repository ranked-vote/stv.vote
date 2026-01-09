# stv.vote

A static site for publishing Single Transferable Vote (STV) election reports.

- Web UI: SvelteKit (Svelte 5) app in `src/` that renders published reports
- Data: SQLite database (`data.sqlite3`) stores election data

## Prerequisites

- [Bun](https://bun.sh/) (latest version)
- [mise](https://mise.jdx.dev/) for environment management (optional)

## Quick Start

```bash
# Install dependencies
bun install

# Initialize the database (creates empty tables)
bun run init-db

# Start dev server
bun run dev

# Open http://localhost:5173
```

## Scripts

### Web Development
- `bun run dev`: start SvelteKit dev server
- `bun run build`: build static site to `build/` directory
- `bun run preview`: preview the built site locally
- `bun run check`: run Svelte type checking

### Database
- `bun run init-db`: initialize empty SQLite database with schema
- `bun run load-scotland`: load Scotland 2022 council election data

### Card Image Generation
- `bun run generate-images`: generate share images (automatically starts/stops dev server if needed)
  - Processes images in parallel (default: 5 concurrent, set `CONCURRENCY` env var to adjust)
  - Skips unchanged images

## Build

```bash
bun install
bun run build
# output: build/
```

## Database Schema

The `data.sqlite3` database contains these tables:

- **reports**: Election contest metadata (jurisdiction, date, office, winner, etc.)
- **candidates**: Candidates for each contest with vote totals
- **rounds**: Tabulation rounds for each contest
- **allocations**: Vote allocations within each round
- **transfers**: Vote transfers between eliminated candidates

## Adding Election Data

You can add election data using SQL or by creating a load script similar to `scripts/load-report.js` in the approval-vote project:

```javascript
import { Database } from "bun:sqlite";

const db = new Database("data.sqlite3");

// Insert a report
const result = db.prepare(`
  INSERT INTO reports (name, date, jurisdictionPath, electionPath, office, ...)
  VALUES (?, ?, ?, ?, ?, ...)
`).run(...values);

const reportId = result.lastInsertRowid;

// Insert candidates
db.prepare(`
  INSERT INTO candidates (report_id, candidate_index, name, firstRoundVotes, ...)
  VALUES (?, ?, ?, ?, ...)
`).run(reportId, ...candidateValues);

// Insert rounds, allocations, transfers...
```

## Project Structure

- `src/`: SvelteKit app (Svelte 5 components, routes, API endpoints)
  - `src/lib/`: Shared library code
    - `src/lib/server/`: Server-only code (database access)
    - `src/lib/report_types.ts`: TypeScript type definitions
  - `src/routes/`: SvelteKit routes
  - `src/components/`: Svelte components
- `static/`: static assets copied to build
  - `static/share/`: Generated card images for social media sharing
- `scripts/`: Utility scripts
- `data.sqlite3`: SQLite database with election data
- `build/`: static site build output (gitignored)

## Deployment

Deploys are handled by GitHub Pages via `.github/workflows/deploy.yml`:

- On push to `main`/`master`, CI installs dependencies, builds, and publishes `build/` to Pages

## Data Sources

### Scotland 2022 Council Elections
Scotland council election data (`raw-data/scotland/2022/`) is made available under the **CC-BY-SA 4.0** license. Attribution: [@gerrymulvenna](https://github.com/gerrymulvenna), containing candidate data provided by [Democracy Club](https://democracyclub.org.uk/).

## License

Website content and generated reports may be freely distributed with attribution under CC-BY.
