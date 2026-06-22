# Portfolio Intelligence — Claude Context

## What this project is

A single-user, locally-hosted property investment dashboard. Not accounting software — a BI-style tool to answer three questions: *What do I own today? What happens if I make changes? What should I buy next?*

## Test commands

```bash
npm test              # Run all tests once
npm run test:watch    # Watch mode (re-runs on save)
npm run test:coverage # Run with V8 coverage report → coverage/
```

Tests live in `tests/` mirroring source structure:
- `tests/server/calculations.test.ts` — `calculatePropertyFinancials`, `calculateAcquisitionMetrics`, `calculatePortfolioKPIs`
- `tests/server/scenarioEngine.test.ts` — `buildProjection` pure function (events, cashflow, growth model)
- `tests/src/utils.currency.test.ts` — `formatCurrency`, `formatPercent`, `formatNumber`
- `tests/src/utils.calculations.test.ts` — client-side calculation helpers
- `tests/src/utils.dates.test.ts` — `formatDate`, `formatMonthYear`, `daysUntil`, `today`

The scenario engine exposes `buildProjection(initialState, events, config)` for testing without a DB. `runScenario()` loads from DB then calls it.

## Dev commands

```bash
npm run dev        # Vite (:5174) + Express (:3001) together — start here
npm run db:seed    # Insert demo data (idempotent — safe to run multiple times)
npm run build      # Vite production build → dist/
npm run server     # Express only (tsx watch)
npm run client     # Vite only
```

## Architecture

- **Frontend**: React 19 + TypeScript, Vite, Tailwind v4, React Router v7, TanStack Query v5
- **Backend**: Express v5 via `tsx watch`, runs on :3001
- **Database**: `better-sqlite3` — synchronous SQLite, no ORM. DB file is `server/db/portfolio.db` (auto-created on first run)
- **Dev proxy**: Vite proxies `/api/*` → `http://localhost:3001`
- **Production**: Express serves `dist/` statically; `npm run build` then `npm run server`

## Project layout

```
server/
  db/
    schema.sql          18 tables — runs idempotently on every server start
    database.ts         Singleton getDb(), queryAll<T>(), queryOne<T>(), execute(), transaction()
    migrate.ts          Numbered .sql migrations in server/db/migrations/
    seeds/seed.ts       4 UK demo properties + all sub-data
  routes/               One file per resource — dashboard, properties, tenants, mortgages,
                        finances, maintenance, certificates, documents, acquisitions,
                        scenarios, reports
  services/
    calculations.ts     ALL financial logic (yield, ROI, LTV, cashflow) — server is source of truth
    scenarioEngine.ts   Month-by-month projection engine
    activityLogger.ts   Writes to activity_log after every mutation
  index.ts              Express entry: runs migrations, mounts routers

src/
  types/index.ts        All TypeScript interfaces — start here for data shapes
  services/api.ts       Typed fetch wrapper: api.get/post/put/patch/delete
  hooks/                TanStack Query hooks with key factories (useProperties, useFinancials, etc.)
  pages/                One file per route (Dashboard, Portfolio, PropertyDetail, Financials,
                        Calendar, Acquisitions, Scenarios, BusinessOverview, Reports)
  components/
    charts/index.tsx    Recharts wrappers (IncomeAreaChart, CashflowBarChart, ExpenseDonutChart,
                        ScenarioAreaChart, ValuationAreaChart)
    forms/              PropertyForm, TenantForm, MortgageForm, MaintenanceForm, CertificateForm
    shared/             KPICard, StatusBadge, LoadingSpinner, ConfirmDialog
  layouts/AppLayout.tsx Fixed 240px sidebar, NavLink active states, theme toggle
  utils/
    currency.ts         formatCurrency(amount, compact?), formatPercent(), formatNumber()
    dates.ts            formatDate(), formatMonthYear(), daysUntil(), today()
    calculations.ts     Client-side mirrors of server calculations (for live form preview only)
```

## Key patterns

**Database access** — always use the typed helpers, never raw `db.prepare` outside `database.ts`:
```typescript
const rows = queryAll<MyType>('SELECT * FROM table WHERE id = ?', [id])
const row  = queryOne<MyType>('SELECT * FROM table WHERE id = ?', [id])
execute('INSERT INTO table ...', [values])
transaction(() => { /* multiple statements */ })
```

**Financial calculations** — `server/services/calculations.ts` is the single source of truth. The client-side `src/utils/calculations.ts` mirrors only exist for live form preview (Acquisitions page). Don't add new financial logic client-side.

**Query key factory pattern** — hooks use key factories so invalidation is precise:
```typescript
propertyKeys.all     // ['properties']
propertyKeys.lists() // ['properties', 'list']
propertyKeys.detail(id) // ['properties', 'detail', id]
```
Mutations invalidate `['dashboard']` as well as the resource key.

**Activity logging** — every successful create/update/delete in a route should call `logActivity()` from `activityLogger.ts`. This feeds the Dashboard activity feed.

**Certificate status** — computed live via `computeStatus(expiry_date)` in `certificates.ts` at query time, not stored. Don't trust the `status` column for freshness.

**Tailwind v4 CSS-first** — no `tailwind.config.ts`. All theme tokens are CSS custom properties in `src/styles/globals.css` inside `@theme {}`. Dark mode is the default; `.light` class overrides for light mode. The `@tailwindcss/vite` plugin handles compilation.

## TypeScript notes

- `tsconfig.json` has `"ignoreDeprecations": "6.0"` for TS6 `baseUrl` deprecation
- `zodResolver(schema) as any` pattern used on all forms with `z.coerce.number()` fields — known RHF/Zod type mismatch with coerce
- Recharts `formatter` and `labelFormatter` props cast to `any` in `charts/index.tsx` — Recharts generic types are overly broad

## Database schema (18 tables)

`properties` → `tenants`, `mortgages`, `rent_payments`, `expenses`, `maintenance_records`, `documents`, `certificates`, `property_valuations`
`acquisition_opportunities` → `comparable_sales`, `comparable_rentals`
`scenarios` → `scenario_events`, `scenario_results`
`market_data`, `financial_snapshots`, `activity_log`

All FKs use `ON DELETE CASCADE` or `SET NULL`. `PRAGMA foreign_keys = ON` and `journal_mode = WAL` set on connection open.

## Seed data (demo)

4 UK properties: Stockport (house), Leeds (flat), Sheffield (HMO), Manchester (house)
- 12 months rent payments per property (one late, one missed for realism)
- Gas Safety cert expiring in 18 days on Stockport property (triggers compliance warning)
- EPC expired on Leeds flat
- 3 acquisition pipeline deals at different stages
- 2 what-if scenarios (base case + growth strategy)
- 12 activity log entries

Re-seed: `npm run db:seed` — guards with `COUNT(*) > 0`, won't duplicate.
To reset: delete `portfolio.db` then re-run `npm run db:seed`.
