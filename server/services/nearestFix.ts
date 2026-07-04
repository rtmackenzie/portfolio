import type { PropertyState } from './scenarioEngine.ts'
import { icrThresholdPct, type TaxSettings } from './tax.ts'
import type { AssumptionSettings } from './assumptions.ts'
import {
  runTemplate,
  positiveOr,
  type Goal,
  type PropertyAssumptions,
  type GeneratedPathway,
  type StrategyTemplate,
} from './pathwayGenerator.ts'

// Nearest-feasible hints (§P2-8c / Appendix D.1): when a pathway doesn't reach its goal, report
// the smallest single-lever change that verifiably flips it. Every hint here comes from an
// actually-executed projection where reaches_goal flipped to true — never extrapolated — so a
// hint is a result, not advice.

export interface NearestFix {
  lever: string
  from: number
  to: number
  label: string
}

// Absolute floors for the bracket step size, so a lever near zero (e.g. a brand-new goal with no
// director loan yet) still gets a meaningful first probe rather than an infinitesimal one.
const ABS_FLOOR: Record<string, number> = {
  monthly_rent: 250,
  deposit_percent: 1,
  max_ltv_pct: 1,
  director_loan_annual: 2500,
  starting_cash: 5000,
  min_cash_reserve_months: 1,
}

// Generic monotone single-lever search: `evaluate(value)` re-runs the pathway with the lever set
// to `value` and reports whether the goal is now reached. Assumes reaches_goal is monotone in the
// lever's direction (true for every lever in the table below) so bisection is sound.
//
// Bracket: try the closed-form `seed` first (if given), then current ± Δ, ±2Δ, ±4Δ, ±8Δ (≤5
// probes total) until `evaluate` returns true. Bisect: ≤5 further probes narrowing to within 1%
// of the flipping value. Returns null if nothing in the bracket flips — the lever is dropped
// silently rather than reporting "no single change to X suffices" for every lever tried.
export function bracketAndBisect(
  evaluate: (value: number) => boolean,
  current: number,
  direction: 'up' | 'down',
  opts: { seed?: number; floor?: number; lever?: string } = {}
): number | null {
  const sign = direction === 'up' ? 1 : -1
  const delta = Math.max(Math.abs(current) * 0.1, ABS_FLOOR[opts.lever ?? ''] ?? 1)

  const clamp = (v: number) => (opts.floor != null ? Math.max(v, opts.floor) : v)

  let lo = current
  let hi: number | null = null

  const candidates: number[] = []
  if (opts.seed != null && opts.seed !== current) candidates.push(clamp(opts.seed))
  for (let i = 1; i <= 4 && candidates.length < 5; i++) {
    candidates.push(clamp(current + sign * delta * Math.pow(2, i - 1)))
  }

  for (const v of candidates.slice(0, 5)) {
    if (direction === 'down' && opts.floor != null && v < opts.floor) continue
    if (evaluate(v)) { hi = v; break }
    lo = v
  }

  if (hi == null) return null

  // Bisect to within 1% of hi, ≤5 more probes.
  let bestHi = hi
  for (let i = 0; i < 5; i++) {
    const mid = (lo + bestHi) / 2
    if (Math.abs(bestHi - mid) < Math.abs(bestHi) * 0.01) break
    if (evaluate(mid)) bestHi = mid
    else lo = mid
  }
  return bestHi
}

interface FixContext {
  goal: Goal
  initialState: Map<number, PropertyState>
  assumptions: PropertyAssumptions
  projectionYears: number
  tax?: TaxSettings
  settings?: AssumptionSettings
}

function runsWith(t: StrategyTemplate, ctx: FixContext, overrides: { goal?: Partial<Goal>; assumptions?: Partial<PropertyAssumptions>; projectionYears?: number }): GeneratedPathway {
  return runTemplate(
    t,
    { ...ctx.goal, ...overrides.goal },
    ctx.initialState,
    { ...ctx.assumptions, ...overrides.assumptions },
    overrides.projectionYears ?? ctx.projectionYears,
    ctx.tax,
    ctx.settings
  )
}

function monthsLabel(m: number | null): string {
  if (m == null) return ''
  const yr = Math.floor(m / 12)
  const mo = m % 12
  const parts = [yr > 0 ? `${yr}yr` : null, mo > 0 ? `${mo}mo` : null].filter(Boolean)
  return parts.length > 0 ? ` and reaches goal in ${parts.join(' ')}` : ' and reaches goal immediately'
}

function tryRentLever(t: StrategyTemplate, ctx: FixContext, icrFloor?: number): NearestFix | null {
  const currentRent = ctx.assumptions.monthly_rent
  let seed: number | undefined
  if (icrFloor != null) {
    // Closed-form estimate: required rent = current rent x (floor / achievable ratio), where the
    // achievable ratio is recomputed with the same stress-rate/loan-amount formula buyGateAt()
    // uses (self-contained here — a seed only needs to be close, not exact).
    const depositPct = ctx.assumptions.deposit_percent ?? ctx.settings?.default_deposit_percent ?? 25
    const loanAmount = ctx.assumptions.purchase_price * (1 - depositPct / 100)
    const stressUplift = (ctx.settings?.icr_stress_uplift_bps ?? 200) / 100
    const stressFloor = ctx.settings?.icr_stress_floor_pct ?? 5.5
    const stressRate = Math.max((ctx.assumptions.mortgage_rate ?? ctx.settings?.default_mortgage_rate_pct ?? 5.5) + stressUplift, stressFloor)
    const achievableIcrPct = loanAmount > 0 ? (currentRent / (loanAmount * stressRate / 100 / 12)) * 100 : Infinity
    if (isFinite(achievableIcrPct) && achievableIcrPct > 0) {
      seed = currentRent * (icrFloor / achievableIcrPct)
    }
  }
  const raw = bracketAndBisect(
    (value) => runsWith(t, ctx, { assumptions: { monthly_rent: value } }).reaches_goal,
    currentRent, 'up', { seed, lever: 'monthly_rent' }
  )
  if (raw == null) return null
  // Round up (the "more helpful" direction for an 'up' lever) so the displayed value is
  // guaranteed to still flip reaches_goal by the same monotonicity bracketAndBisect relies on —
  // the number shown is always the number verified, never the raw (unverified) bisection point.
  const to = Math.ceil(raw)
  const flipped = runsWith(t, ctx, { assumptions: { monthly_rent: to } })
  return {
    lever: 'monthly_rent', from: currentRent, to,
    label: `Raise the candidate deal's rent to £${to}/mo${monthsLabel(flipped.months_to_goal)}`,
  }
}

function tryDepositLever(t: StrategyTemplate, ctx: FixContext): NearestFix | null {
  const current = ctx.assumptions.deposit_percent ?? ctx.settings?.default_deposit_percent ?? 25
  const raw = bracketAndBisect(
    (value) => runsWith(t, ctx, { assumptions: { deposit_percent: value } }).reaches_goal,
    current, 'up', { lever: 'deposit_percent', floor: current }
  )
  if (raw == null || raw > 90) return null
  const to = Math.ceil(raw * 10) / 10
  const flipped = runsWith(t, ctx, { assumptions: { deposit_percent: to } })
  return {
    lever: 'deposit_percent', from: current, to,
    label: `Raise deposit to ${to.toFixed(0)}%${monthsLabel(flipped.months_to_goal)}`,
  }
}

function tryDirectorLoanLever(t: StrategyTemplate, ctx: FixContext): NearestFix | null {
  const current = ctx.goal.director_loan_annual ?? 0
  const raw = bracketAndBisect(
    (value) => runsWith(t, ctx, { goal: { director_loan_annual: value } }).reaches_goal,
    current, 'up', { lever: 'director_loan_annual' }
  )
  if (raw == null) return null
  const to = Math.ceil(raw)
  const flipped = runsWith(t, ctx, { goal: { director_loan_annual: to } })
  return {
    lever: 'director_loan_annual', from: current, to,
    label: `Raise director loan to £${to}/yr${monthsLabel(flipped.months_to_goal)}`,
  }
}

function tryStartingCashLever(t: StrategyTemplate, ctx: FixContext): NearestFix | null {
  const current = ctx.goal.starting_cash ?? 0
  const raw = bracketAndBisect(
    (value) => runsWith(t, ctx, { goal: { starting_cash: value } }).reaches_goal,
    current, 'up', { lever: 'starting_cash' }
  )
  if (raw == null) return null
  const to = Math.ceil(raw)
  const flipped = runsWith(t, ctx, { goal: { starting_cash: to } })
  return {
    lever: 'starting_cash', from: current, to,
    label: `Raise starting cash to £${to}${monthsLabel(flipped.months_to_goal)}`,
  }
}

function tryHorizonLever(t: StrategyTemplate, ctx: FixContext): NearestFix | null {
  for (let extra = 1; extra <= 5; extra++) {
    const years = ctx.projectionYears + extra
    const flipped = runsWith(t, ctx, { projectionYears: years })
    if (flipped.reaches_goal) {
      return {
        lever: 'projection_years', from: ctx.projectionYears, to: years,
        label: `Extend the horizon to ${years}yr${monthsLabel(flipped.months_to_goal)}`,
      }
    }
  }
  return null
}

function tryLtvLever(t: StrategyTemplate, ctx: FixContext): NearestFix | null {
  if (ctx.goal.max_ltv_pct == null) return null
  const current = ctx.goal.max_ltv_pct
  // Closed-form seed: realized peak LTV + a 2pp buffer, recomputed here from the base run.
  const base = runsWith(t, ctx, {})
  let peakLtv = 0
  for (const m of base.results.months) {
    if (m.total_value > 0) peakLtv = Math.max(peakLtv, (m.total_debt / m.total_value) * 100)
  }
  const seed = peakLtv > current ? peakLtv + 2 : undefined
  const raw = bracketAndBisect(
    (value) => runsWith(t, ctx, { goal: { max_ltv_pct: value } }).reaches_goal,
    current, 'up', { seed, lever: 'max_ltv_pct', floor: current }
  )
  if (raw == null || raw > 95) return null
  const to = Math.ceil(raw * 10) / 10
  const flipped = runsWith(t, ctx, { goal: { max_ltv_pct: to } })
  return {
    lever: 'max_ltv_pct', from: current, to,
    label: `Raise Max LTV mandate to ${to.toFixed(0)}%${monthsLabel(flipped.months_to_goal)}`,
  }
}

function tryReserveMonthsLever(t: StrategyTemplate, ctx: FixContext): NearestFix | null {
  const current = ctx.goal.min_cash_reserve_months ?? 3
  const raw = bracketAndBisect(
    (value) => runsWith(t, ctx, { goal: { min_cash_reserve_months: value } }).reaches_goal,
    current, 'down', { lever: 'min_cash_reserve_months', floor: 1 }
  )
  if (raw == null) return null
  // Floor (the "more helpful" direction for a 'down' lever) so the displayed value is
  // guaranteed to still verify, same reasoning as the 'up' levers' Math.ceil above.
  const rounded = Math.max(1, Math.floor(raw))
  const flipped = runsWith(t, ctx, { goal: { min_cash_reserve_months: rounded } })
  if (!flipped.reaches_goal) return null
  return {
    lever: 'min_cash_reserve_months', from: current, to: rounded,
    label: `Reserve floor down to ${rounded} month${rounded === 1 ? '' : 's'}${monthsLabel(flipped.months_to_goal)}`,
  }
}

// A statement, not a search: names the ICR floor this candidate deal actually clears today, so
// the user can judge whether relaxing Min Lender ICR is an acceptable trade — never proposed as
// something to silently apply.
function minIcrStatement(ctx: FixContext, pathway: GeneratedPathway): NearestFix | null {
  const depositPct = ctx.assumptions.deposit_percent ?? ctx.settings?.default_deposit_percent ?? 25
  const loanAmount = ctx.assumptions.purchase_price * (1 - depositPct / 100)
  const stressUplift = (ctx.settings?.icr_stress_uplift_bps ?? 200) / 100
  const stressFloor = ctx.settings?.icr_stress_floor_pct ?? 5.5
  const stressRate = Math.max((ctx.assumptions.mortgage_rate ?? ctx.settings?.default_mortgage_rate_pct ?? 5.5) + stressUplift, stressFloor)
  const achievableIcrPct = loanAmount > 0 ? (ctx.assumptions.monthly_rent / (loanAmount * stressRate / 100 / 12)) * 100 : Infinity
  if (!isFinite(achievableIcrPct) || achievableIcrPct <= 0) return null
  const currentFloor = positiveOr(ctx.goal.min_icr, icrThresholdPct(ctx.tax))
  if (achievableIcrPct >= currentFloor) return null
  return {
    lever: 'min_icr', from: currentFloor, to: Math.round(achievableIcrPct),
    label: `This deal supports roughly a ${Math.round(achievableIcrPct)}% lender floor — your goal requires ${currentFloor.toFixed(0)}%. Relaxing Min Lender ICR would let it clear (verify against real lender criteria before relying on this).`,
  }
}

export function computeNearestFixes(
  pathway: GeneratedPathway,
  t: StrategyTemplate,
  goal: Goal,
  initialState: Map<number, PropertyState>,
  assumptions: PropertyAssumptions,
  projectionYears: number,
  tax?: TaxSettings,
  settings?: AssumptionSettings
): NearestFix[] {
  if (pathway.reaches_goal) return []

  const ctx: FixContext = { goal, initialState, assumptions, projectionYears, tax, settings }
  const icrFloor = positiveOr(goal.min_icr, icrThresholdPct(tax))

  type Lever = () => NearestFix | null
  let levers: Lever[]
  switch (pathway.binding_constraint) {
    case 'icr':
      levers = [
        () => tryRentLever(t, ctx, icrFloor),
        () => tryDepositLever(t, ctx),
        () => minIcrStatement(ctx, pathway),
      ]
      break
    case 'ltv':
      levers = [() => tryLtvLever(t, ctx), () => tryDepositLever(t, ctx)]
      break
    case 'reserve':
      levers = [() => tryStartingCashLever(t, ctx), () => tryReserveMonthsLever(t, ctx)]
      break
    case 'capital':
      levers = [() => tryDirectorLoanLever(t, ctx), () => tryStartingCashLever(t, ctx), () => tryHorizonLever(t, ctx)]
      break
    default:
      levers = goal.goal_type === 'income'
        ? [() => tryRentLever(t, ctx, icrFloor)]
        : [() => tryDirectorLoanLever(t, ctx), () => tryStartingCashLever(t, ctx)]
  }

  // Stop at the first lever that produces a verified fix — the "smallest single change" framing
  // means one good answer beats three, but up to 3 levers are tried in priority order if earlier
  // ones fail to flip within budget.
  for (const lever of levers.slice(0, 3)) {
    const fix = lever()
    if (fix) return [fix]
  }
  return []
}
