// Portfolio-level return metrics (§P2-9): IRR, equity multiple, ROCE, cash-on-cash,
// net yield on cost, payback period. Pure functions — no DB access, no engine state,
// just the numbers `buildProjection` already produces.

// Monthly-rate bisection IRR solver. Returns the ANNUALIZED rate, or null if the
// cashflow series has no sign change (no solvable root) or is degenerate.
export function solveIRR(monthlyCashflows: number[]): number | null {
  if (monthlyCashflows.length < 2) return null
  const hasPositive = monthlyCashflows.some(c => c > 0)
  const hasNegative = monthlyCashflows.some(c => c < 0)
  if (!hasPositive || !hasNegative) return null

  const npv = (monthlyRate: number) =>
    monthlyCashflows.reduce((sum, cf, i) => sum + cf / Math.pow(1 + monthlyRate, i), 0)

  // Bisect over a numerically-safe monthly-rate band. Bounds close to -1 cause
  // (1+r)^i to underflow to 0 over long horizons (100+ months), which corrupts the
  // NPV via division blow-ups — -50%/mo to +100%/mo comfortably covers any real
  // property-investment IRR while staying numerically stable.
  let lo = -0.5, hi = 1
  let npvLo = npv(lo), npvHi = npv(hi)
  if (npvLo * npvHi > 0) return null

  let mid = 0
  for (let i = 0; i < 100; i++) {
    mid = (lo + hi) / 2
    const npvMid = npv(mid)
    if (Math.abs(npvMid) < 1e-6) break
    if ((npvMid > 0) === (npvLo > 0)) { lo = mid; npvLo = npvMid } else { hi = mid }
  }
  const annualized = Math.pow(1 + mid, 12) - 1
  return Math.round(annualized * 10000) / 100
}

// IRR methodology (§P1-4 / Appendix C): three conventions produce three different "correct"
// numbers from the same plan, so the tier that actually rendered is returned alongside the
// value — an unlabelled IRR invites comparison against a number computed a different way.
export type IrrBasis = 'capital_account' | 'mirr' | 'annualised_multiple'

export interface InvestorFlowInputs {
  capitalDeployed: number[]    // per-month capital calls (deposits+fees, capex, ERC) — always ≥ 0
  directorLoanIn: number[]     // per-month contributions received — always ≥ 0
  directorLoanRepay: number[]  // per-month repayments made — always ≥ 0
  financeRatePctAnnual?: number  // MIRR's finance rate; defaults to 5.5 (the engine's literal mortgage-rate default)
}

// Capital-account (investor-perspective) flow series (Appendix C.2): the investor's own
// contributions/repayments, not the portfolio's unified cash ledger. Retained operating cashflow
// is deliberately NOT distributed monthly — it accumulates into the terminal value instead,
// which is what guarantees the sign structure (negative early, one large terminal inflow) an
// IRR needs, and mirrors how a Ltd BTL structure actually works (profits retained, extracted
// later).
export function buildInvestorFlows(
  inputs: InvestorFlowInputs,
  endEquity: number,
  endingOperatingCashPot: number
): number[] {
  const { capitalDeployed, directorLoanIn, directorLoanRepay } = inputs
  const flows = capitalDeployed.map((cd, i) =>
    -cd - (directorLoanIn[i] ?? 0) + (directorLoanRepay[i] ?? 0)
  )
  if (flows.length > 0) flows[flows.length - 1] += endEquity + endingOperatingCashPot
  return flows
}

// Modified IRR (Appendix C.3, tier 2): single-valued by construction, so it's the right
// fallback when capital-account flows have multiple sign changes (heavy BRRR-style refinance
// churn) and the plain bisection solver can't resolve a single root. PV of the negative flows at
// the finance rate, FV of the positive flows at the reinvestment rate (0 per Appendix C.3, so FV
// is just their raw sum), annualized the same way solveIRR already is.
export function computeMIRR(
  monthlyCashflows: number[],
  financeRatePctAnnual: number,
  reinvestRatePctAnnual: number
): number | null {
  const n = monthlyCashflows.length
  if (n < 2) return null
  const financeRateMonthly = Math.pow(1 + financeRatePctAnnual / 100, 1 / 12) - 1
  const reinvestRateMonthly = Math.pow(1 + reinvestRatePctAnnual / 100, 1 / 12) - 1

  let pvNegative = 0
  let fvPositive = 0
  for (let i = 0; i < n; i++) {
    const cf = monthlyCashflows[i]
    if (cf < 0) pvNegative += cf / Math.pow(1 + financeRateMonthly, i)
    else if (cf > 0) fvPositive += cf * Math.pow(1 + reinvestRateMonthly, n - 1 - i)
  }
  if (pvNegative === 0 || fvPositive === 0) return null

  const monthlyMirr = Math.pow(fvPositive / -pvNegative, 1 / (n - 1)) - 1
  const annualized = Math.pow(1 + monthlyMirr, 12) - 1
  return Math.round(annualized * 10000) / 100
}

// The (1+IRR)^years ≈ equity-multiple reconciliation is only a mathematical requirement when
// the flow series is genuinely front-loaded (one contiguous negative block at the start,
// everything after ≥ 0) — real multi-purchase pathways drip-fund capital calls throughout the
// horizon, where IRR and multiple legitimately diverge without any defect. Only apply the
// consistency guard when this holds.
export function isFrontLoaded(flows: number[]): boolean {
  let seenNonNegative = false
  for (const f of flows) {
    if (f < 0) {
      if (seenNonNegative) return false
    } else {
      seenNonNegative = true
    }
  }
  return true
}

export interface ReturnMetrics {
  equity_multiple: number | null
  irr_pct: number | null
  irr_basis: IrrBasis | null
  roce_pct: number | null
  cash_on_cash_pct: number | null
  net_yield_on_cost_pct: number | null
  months_to_payback: number | null
}

export function computeReturnMetrics(
  cumulativeCashflows: number[],   // one per month, already including starting cash
  startingCash: number,
  totalCapitalInvested: number,
  totalCashflowPosttax: number,
  endingMonthlyCashflowPosttax: number,
  endingMonthlyRent: number,
  endEquity: number,
  projectionYears: number,
  investorFlowInputs?: InvestorFlowInputs
): ReturnMetrics {
  if (totalCapitalInvested <= 0) {
    return {
      equity_multiple: null, irr_pct: null, irr_basis: null, roce_pct: null,
      cash_on_cash_pct: null, net_yield_on_cost_pct: null, months_to_payback: null,
    }
  }

  // totalCashflowPosttax is the ENDING cumulative_cashflow_posttax, which already nets
  // capital outflows (deposits/fees/capex/ERC) together with operating cashflow — add
  // totalCapitalInvested back (and remove the starting-cash baseline) to isolate the
  // pure operating cash actually received, so it isn't double-subtracted here.
  const operatingCashReceived = totalCashflowPosttax - startingCash + totalCapitalInvested
  const equity_multiple = Math.round(((endEquity + operatingCashReceived) / totalCapitalInvested) * 100) / 100
  const roce_pct = projectionYears > 0
    ? Math.round(((equity_multiple - 1) / projectionYears) * 10000) / 100
    : null
  const cash_on_cash_pct = Math.round((endingMonthlyCashflowPosttax * 12 / totalCapitalInvested) * 10000) / 100
  const net_yield_on_cost_pct = Math.round((endingMonthlyRent * 12 / totalCapitalInvested) * 10000) / 100

  // IRR fallback ladder (§P1-4 / Appendix C): capital-account basis first, then MIRR when no
  // root exists, then an annualised equity multiple when there's no per-month capital/loan
  // timeline to build investor flows from at all.
  let irr_pct: number | null = null
  let irr_basis: IrrBasis | null = null

  if (investorFlowInputs) {
    const flows = buildInvestorFlows(investorFlowInputs, endEquity, operatingCashReceived)
    const capitalAccountIrr = solveIRR(flows)
    if (capitalAccountIrr != null && (!isFrontLoaded(flows) || reconciles(capitalAccountIrr, equity_multiple, projectionYears))) {
      irr_pct = capitalAccountIrr
      irr_basis = 'capital_account'
    } else {
      const financeRate = investorFlowInputs.financeRatePctAnnual ?? 5.5
      const mirr = computeMIRR(flows, financeRate, 0)
      if (mirr != null) {
        irr_pct = mirr
        irr_basis = 'mirr'
      }
    }
  }
  if (irr_pct == null && equity_multiple > 0 && projectionYears > 0) {
    irr_pct = Math.round((Math.pow(equity_multiple, 1 / projectionYears) - 1) * 10000) / 100
    irr_basis = 'annualised_multiple'
  }

  // Payback = months from the point of maximum capital deployed (the cash-position
  // trough) until cumulative cashflow recovers back to at least the starting position —
  // avoids a false "instant payback" reading when cashflow is positive before any
  // purchase has actually happened yet.
  let months_to_payback: number | null = null
  if (cumulativeCashflows.length > 0) {
    let troughIndex = 0
    for (let i = 1; i < cumulativeCashflows.length; i++) {
      if (cumulativeCashflows[i] < cumulativeCashflows[troughIndex]) troughIndex = i
    }
    for (let i = troughIndex; i < cumulativeCashflows.length; i++) {
      if (cumulativeCashflows[i] >= startingCash) { months_to_payback = i; break }
    }
  }

  return { equity_multiple, roce_pct, cash_on_cash_pct, net_yield_on_cost_pct, irr_pct, irr_basis, months_to_payback }
}

// Consistency invariant (Appendix C.3): a front-loaded plan's IRR and equity multiple must
// reconcile via (1+irr)^years ≈ multiple. A generous tolerance accommodates rounding and the
// month-vs-year compounding boundary — this is a sanity guard against a broken capital-account
// construction, not a precision check.
function reconciles(irrPct: number, equityMultiple: number, years: number): boolean {
  if (years <= 0 || equityMultiple <= 0) return false
  const impliedMultiple = Math.pow(1 + irrPct / 100, years)
  const ratio = impliedMultiple / equityMultiple
  return ratio > 0.5 && ratio < 2
}
