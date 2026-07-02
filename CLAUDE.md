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
- `tests/server/pathwayGenerator.test.ts` — goal → strategy pathway generation (all 4 strategies, ranking, constraints)
- `tests/server/returnMetrics.test.ts` — IRR solver, equity multiple, ROCE, cash-on-cash, payback
- `tests/server/tax.test.ts` — corporation tax / Section 24 personal tax models
- `tests/server/risk.test.ts`, `tests/server/scorecard.test.ts`, `tests/server/insights.test.ts` — risk heatmap, portfolio scorecard, plain-English insights
- `tests/src/utils.currency.test.ts` — `formatCurrency`, `formatPercent`, `formatNumber`
- `tests/src/utils.calculations.test.ts` — client-side calculation helpers
- `tests/src/utils.dates.test.ts` — `formatDate`, `formatMonthYear`, `daysUntil`, `today`
- `tests/src/brief.metrics.test.ts` — scenario-brief derived metrics

The scenario engine exposes `buildProjection(initialState, events, config)` for testing without a DB. `runScenario()` loads from DB then calls it.

## Dev commands

```bash
npm run dev              # Vite (:5174) + Express (:3001) together — start here
npm run db:seed          # Insert demo data (idempotent — safe to run multiple times)
npm run create-scenarios # Seed demo what-if scenarios
npm run build            # Vite production build → dist/
npm run server           # Express only (tsx watch)
npm run client           # Vite only
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
    schema.sql          18 base tables — runs idempotently on every server start
    database.ts         Singleton getDb(), queryAll<T>(), queryOne<T>(), execute(), transaction()
    migrate.ts          Numbered .sql migrations in server/db/migrations/ (14 so far —
                        add goals, goal_pathways, app_settings + column changes)
    seeds/seed.ts       4 UK demo properties + all sub-data
  routes/               One file per resource — dashboard, properties, tenants, mortgages,
                        finances, maintenance, certificates, documents, acquisitions,
                        scenarios, goals, settings, reports
  services/
    calculations.ts     Core financial logic (yield, ROI, LTV, cashflow) — server is source of truth
    scenarioEngine.ts   Month-by-month projection engine — buildProjection() is pure/DB-free
    pathwayGenerator.ts Goal → 4 generated strategy pathways (Target & Hold, Maximise Cashflow,
                        Low-Risk Hold, BRRR) with risk scoring + ranking
    returnMetrics.ts    IRR, equity multiple, ROCE, cash-on-cash, net yield on cost, payback
    tax.ts              Corporation tax / Section 24 personal tax models
    assumptions.ts      Global assumption defaults (AssumptionSettings) — the Settings tier
    settings.ts         app_settings load/save (loadTaxSettings, loadAssumptionSettings)
    risk.ts             Risk heatmap factors per property
    scorecard.ts        Portfolio health scorecard
    insights.ts         Plain-English narrative insights over scorecard + heatmap
    portfolioFacts.ts   Shared portfolio fact loader for scorecard/heatmap
    activityLogger.ts   Writes to activity_log after every mutation
  index.ts              Express entry: runs migrations, mounts routers

src/
  types/index.ts        All TypeScript interfaces — start here for data shapes
  services/api.ts       Typed fetch wrapper: api.get/post/put/patch/delete
  hooks/                TanStack Query hooks with key factories (useProperties, useFinancials,
                        useGoals, useSettings, useScorecard, useRiskHeatmap, useInsights, etc.)
  pages/                One file per route (Dashboard, Portfolio, PropertyDetail, Financials,
                        Calendar, Acquisitions, Scenarios, Goals, BusinessOverview, Reports,
                        Settings, ScenarioBriefPage — routes /brief/scenario/:id, /brief/compare)
  components/
    charts/index.tsx    Recharts wrappers (IncomeAreaChart, CashflowBarChart, ExpenseDonutChart,
                        ScenarioAreaChart, ValuationAreaChart)
    forms/              PropertyForm, TenantForm, MortgageForm, MaintenanceForm, CertificateForm,
                        ExpenseForm, ValuationForm
    reports/            ScenarioBrief (printable scenario brief)
    shared/             KPICard, StatusBadge, LoadingSpinner, EmptyState,
                        InsightsList, RiskHeatmap, ScenarioCompareTable
  layouts/AppLayout.tsx Fixed 240px sidebar, NavLink active states, theme toggle
  utils/
    currency.ts         formatCurrency(amount, compact?), formatPercent(), formatNumber()
    dates.ts            formatDate(), formatMonthYear(), daysUntil(), today()
    calculations.ts     Client-side mirrors of server calculations (for live form preview only)
    briefMetrics.ts     Derived metrics for the scenario brief
    pdf.ts              jsPDF export helpers

docs/
  index.html                            Documentation hub — link new docs here
  what-if-product-strategy.html         What-If module product strategy / roadmap
  investment-committee-review-v1.html   First independent review (Jun 2026, verdict 🟠)
  investment-committee-review-v2.html   Second review (Jul 2026, verdict 🟡) + design
                                        appendices A–C (Monte-Carlo, risk ranking, IRR)
```

Committee reviews are versioned `-vN` and must be added to `docs/index.html`.

## Key patterns

**Database access** — always use the typed helpers, never raw `db.prepare` outside `database.ts`:
```typescript
const rows = queryAll<MyType>('SELECT * FROM table WHERE id = ?', [id])
const row  = queryOne<MyType>('SELECT * FROM table WHERE id = ?', [id])
execute('INSERT INTO table ...', [values])
transaction(() => { /* multiple statements */ })
```

**Financial calculations** — the server is the single source of truth: `calculations.ts` (core metrics), `returnMetrics.ts` (return metrics), `tax.ts` (tax). The client-side `src/utils/calculations.ts` mirrors only exist for live form preview (Acquisitions page). Don't add new financial logic client-side.

**Three-tier assumption fallback** — every engine assumption resolves per-scenario/goal `assumptions_json` → global Settings (`app_settings` via `assumptions.ts`/`settings.ts`, edited on the Settings page) → engine literal default. New assumptions must follow this pattern.

**Scenario engine + pathway generation** — `buildProjection(initialState, events, config)` is pure and DB-free. `generatePathways()` builds events greedily, re-projecting after every cash-gated decision so each choice sees the updated cash pot. Strategy-defining constants (BRRR trigger <65% LTV → refinance to 75%; de-gear ≤2 mortgages) are deliberate engine literals, not Settings.

**Synthetic property IDs** — `scenario_events.property_id` has an FK to `properties`; events targeting a property bought *within* the simulation (no DB row) must set `property_id: null` and carry the target as `sim_property_id` in `parameters_json` (see `payoff_mortgage` and `remortgage` handlers).

**Tooltips** — the `Tip` hover component is duplicated per-page (Goals, Scenarios, Settings) rather than shared — follow that precedent.

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

## Database schema (21 tables)

18 base tables in `schema.sql` + 3 added by migrations (`goals`, `goal_pathways`, `app_settings`):

`properties` → `tenants`, `mortgages`, `rent_payments`, `expenses`, `maintenance_records`, `documents`, `certificates`, `property_valuations`
`acquisition_opportunities` → `comparable_sales`, `comparable_rentals`
`scenarios` → `scenario_events`, `scenario_results`
`goals` → `goal_pathways`
`market_data`, `financial_snapshots`, `activity_log`, `app_settings`

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
