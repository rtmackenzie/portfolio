# Property Portfolio Intelligence

A locally-hosted property investment dashboard. Tracks what you own, models what-if scenarios, and surfaces acquisition opportunities — all running on your machine with no cloud dependencies.

## Screenshots

> Dashboard, Portfolio, Acquisitions Kanban, and What-If Scenarios pages

## Features

| Module | What it does |
|--------|-------------|
| **Executive Dashboard** | Portfolio KPIs, monthly income chart, expense breakdown, compliance alerts, activity feed |
| **Portfolio** | Full property CRUD with tenants, mortgages, maintenance logs, certificates, and documents per property |
| **Financials** | YTD P&L, expense tracking, rent roll with payment history |
| **Compliance Calendar** | Certificate expiry tracking (Gas Safety, EPC, EICR, HMO Licence, Fire Risk) with colour-coded urgency |
| **Acquisition Pipeline** | Drag-and-drop Kanban board with auto-calculated deal metrics (yield, ROI, cashflow, deposit required) |
| **What-If Scenarios** | Month-by-month portfolio projection engine with events (buy, sell, remortgage, rent change, vacancy) |
| **Business Overview** | Company-level stats — total assets, debt, equity, annual income by property |
| **Reports** | Printable portfolio summary with per-property table |

## Tech stack

- **Frontend**: React 19 + TypeScript, Vite, Tailwind CSS v4, React Router v7, TanStack Query v5, Recharts
- **Backend**: Express v5 + TypeScript (`tsx watch`)
- **Database**: SQLite via `better-sqlite3` — no setup required, file created automatically
- **Forms**: React Hook Form + Zod
- **DnD**: @dnd-kit/core + @dnd-kit/sortable (Kanban board)

## Prerequisites

- Node.js 18+
- npm 9+

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Insert demo data (4 UK properties, tenants, mortgages, 12 months payments)
npm run db:seed

# 3. Start the dev server
npm run dev
```

Open **http://localhost:5174** — the app loads with demo data pre-populated.

The database file (`portfolio.db`) is created automatically in the project root on first run.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite (:5174) + Express (:3001) concurrently |
| `npm run build` | Production Vite build → `dist/` |
| `npm run server` | Express API only |
| `npm run client` | Vite frontend only |
| `npm run db:seed` | Insert demo data (idempotent) |

## Demo data

The seed creates a realistic 4-property UK portfolio:

| Property | Type | Value | Rent | Notes |
|----------|------|-------|------|-------|
| 42 Bramhall Lane, Stockport | House 3bd | £235k | £1,100/mo | Gas cert expiring in 18 days |
| 8 Victoria Road, Leeds | Flat 2bd | £168k | £850/mo | EPC expired |
| 17 Ecclesall Road, Sheffield | HMO 5bd | £255k | £2,200/mo | Licensed HMO |
| 3 Cheetham Hill Road, Manchester | House 3bd | £175k | £1,050/mo | Recently refurbished |

Also includes 3 acquisition pipeline deals, 2 what-if scenarios, maintenance records, and 12 months of rent payment history.

To reset to a clean state: delete `portfolio.db` then re-run `npm run db:seed`.

## Project structure

```
portfolio/
├── server/
│   ├── db/
│   │   ├── schema.sql          # 18 tables (idempotent)
│   │   ├── database.ts         # SQLite singleton + typed query helpers
│   │   ├── migrate.ts          # Numbered migration runner
│   │   └── seeds/seed.ts       # Demo data
│   ├── routes/                 # One Express router per resource
│   ├── services/
│   │   ├── calculations.ts     # All financial logic (yield, ROI, LTV, cashflow)
│   │   ├── scenarioEngine.ts   # What-if projection engine
│   │   └── activityLogger.ts   # Activity feed writes
│   └── index.ts
├── src/
│   ├── components/
│   │   ├── charts/             # Recharts wrappers
│   │   ├── forms/              # Property, Tenant, Mortgage, Maintenance, Certificate forms
│   │   └── shared/             # KPICard, StatusBadge, etc.
│   ├── hooks/                  # TanStack Query hooks
│   ├── pages/                  # One file per route
│   ├── types/index.ts          # All TypeScript interfaces
│   └── utils/                  # currency, dates, calculations
├── CLAUDE.md                   # Context for AI-assisted development
├── vite.config.ts
└── package.json
```

## Financial calculations

All live in `server/services/calculations.ts`:

```
Gross Yield  = (monthly_rent × 12) / current_value × 100
Net Cashflow = monthly_rent − mortgage_payment − other_expenses
Net Yield    = (net_cashflow × 12) / current_value × 100
LTV          = mortgage_balance / current_value × 100
Equity       = current_value − mortgage_balance
ROI          = (annual_net_cashflow / total_cash_invested) × 100
```

Expenses are normalised to monthly: quarterly ÷ 3, annually ÷ 12.

## Production build

```bash
npm run build          # Compiles React to dist/
NODE_ENV=production npm run server   # Express serves dist/ statically on :3001
```
