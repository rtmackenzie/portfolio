// The Monte-Carlo band (§P1-5b / Appendix A.2): a stochastic companion to the deterministic
// downturn standing case. Samples ONCE PER RUN (persistent regime parameters for that simulated
// world) — never month-by-month i.i.d. noise, which would diversify away exactly the macro risk
// the band exists to show and produce a seductively narrow fan. Determinism is non-negotiable:
// a seeded PRNG means identical inputs always reproduce identical bands, or the feature would be
// unauditable.
import { buildProjection, type PropertyState, type ScenarioEvent, type ScenarioConfig } from './scenarioEngine.ts'

// mulberry32 — a tiny, fast, seeded PRNG. No dependency; ~10 lines.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Box-Muller standard normal, truncated to ±3σ (a truncated-normal approximation adequate for
// this use — rare enough tail draws are simply clamped rather than resampled).
function sampleStandardNormal(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12)
  const u2 = rng()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return Math.max(-3, Math.min(3, z))
}

export function sampleNormal(rng: () => number, mu: number, sigma: number): number {
  return mu + sampleStandardNormal(rng) * sigma
}

// Two correlated normals via a one-line Cholesky decomposition of the 2x2 correlation matrix.
export function sampleCorrelatedNormal(
  rng: () => number, mu1: number, sigma1: number, mu2: number, sigma2: number, rho: number
): [number, number] {
  const z1 = sampleStandardNormal(rng)
  const z2raw = sampleStandardNormal(rng)
  const z2 = rho * z1 + Math.sqrt(1 - rho * rho) * z2raw
  return [mu1 + z1 * sigma1, mu2 + z2 * sigma2]
}

// A right-skewed distribution around `median` (lognormal has median = exp(0) = 1 at its own
// mean-zero log-scale), capped at `cap`. sigmaLn is a first-pass shape estimate — a modelling
// calibration choice, not a tuned figure (Appendix A.2 flags these as UK BTL priors, "reviewed
// annually").
export function sampleShiftedLognormal(rng: () => number, median: number, cap: number, sigmaLn = 0.35): number {
  const factor = Math.exp(sampleStandardNormal(rng) * sigmaLn)
  return Math.max(0, Math.min(cap, median * factor))
}

export function sampleDiscrete(rng: () => number, values: number[], probabilities: number[]): number {
  const r = rng()
  let cumulative = 0
  for (let i = 0; i < values.length; i++) {
    cumulative += probabilities[i]
    if (r < cumulative) return values[i]
  }
  return values[values.length - 1]
}

export interface MonteCarloOptions {
  runs?: number
  seed?: number
  targetMonthlyIncome?: number
}

export interface MonteCarloBand {
  date: string
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
}

export interface MonteCarloResult {
  seed: number
  runs: number
  equity_band: MonteCarloBand[]
  cashflow_band: MonteCarloBand[]
  goal_probability: number | null
}

function percentile(sorted: number[], p: number): number {
  const idx = (sorted.length - 1) * p
  const lo = Math.floor(idx)
  const hi = Math.ceil(idx)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo)
}

function reduceToBand(dates: string[], allRuns: number[][]): MonteCarloBand[] {
  return dates.map((date, monthIdx) => {
    const values = allRuns.map(run => run[monthIdx]).sort((a, b) => a - b)
    return {
      date,
      p10: Math.round(percentile(values, 0.10)),
      p25: Math.round(percentile(values, 0.25)),
      p50: Math.round(percentile(values, 0.50)),
      p75: Math.round(percentile(values, 0.75)),
      p90: Math.round(percentile(values, 0.90)),
    }
  })
}

export function runMonteCarlo(
  initialState: Map<number, PropertyState>,
  events: ScenarioEvent[],
  config: ScenarioConfig,
  options?: MonteCarloOptions
): MonteCarloResult {
  const runs = options?.runs ?? 500
  const seed = options?.seed ?? Math.floor(Math.random() * 0xFFFFFFFF)
  const rng = mulberry32(seed)

  const central = JSON.parse(config.assumptions_json || '{}')
  const centralPropertyGrowthPct = central.property_growth_pct ?? config.defaults?.default_property_growth_pct ?? 3.0
  const centralRentGrowthPct = central.rent_growth_pct ?? config.defaults?.default_rent_growth_pct ?? 2.5
  const centralVoidMonths = central.void_months_per_year ?? config.defaults?.default_void_months_per_year ?? 1
  const centralArrearsPct = central.arrears_pct ?? config.defaults?.arrears_pct ?? 1.5

  let dates: string[] = []
  const equityRuns: number[][] = []
  const cashflowRuns: number[][] = []
  let targetHits = 0

  for (let r = 0; r < runs; r++) {
    const [propertyGrowthPct, rentGrowthPct] = sampleCorrelatedNormal(rng, centralPropertyGrowthPct, 3.5, centralRentGrowthPct, 1.5, 0.6)
    const voidMonthsPerYear = sampleShiftedLognormal(rng, centralVoidMonths, 4)
    const arrearsPct = sampleShiftedLognormal(rng, centralArrearsPct, 4)
    const repriceUpliftBps = sampleDiscrete(rng, [0, 100, 200, 300], [0.2, 0.4, 0.3, 0.1])

    const runAssumptionsJson = JSON.stringify({
      ...central,
      property_growth_pct: propertyGrowthPct,
      rent_growth_pct: rentGrowthPct,
      void_months_per_year: voidMonthsPerYear,
      arrears_pct: arrearsPct,
      mortgage_reprice_uplift_bps: repriceUpliftBps,
    })

    const proj = buildProjection(initialState, events, { ...config, assumptions_json: runAssumptionsJson }) as {
      months: { date: string; total_equity: number; cumulative_cashflow_posttax: number; monthly_cashflow_posttax: number }[]
    }

    if (r === 0) dates = proj.months.map(m => m.date)
    equityRuns.push(proj.months.map(m => m.total_equity))
    cashflowRuns.push(proj.months.map(m => m.cumulative_cashflow_posttax))

    if (options?.targetMonthlyIncome != null) {
      const last = proj.months[proj.months.length - 1]
      if (last && last.monthly_cashflow_posttax >= options.targetMonthlyIncome) targetHits++
    }
  }

  return {
    seed,
    runs,
    equity_band: reduceToBand(dates, equityRuns),
    cashflow_band: reduceToBand(dates, cashflowRuns),
    goal_probability: options?.targetMonthlyIncome != null ? Math.round((targetHits / runs) * 1000) / 1000 : null,
  }
}
