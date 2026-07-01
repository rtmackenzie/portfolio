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

export interface ReturnMetrics {
  equity_multiple: number | null
  irr_pct: number | null
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
  projectionYears: number
): ReturnMetrics {
  if (totalCapitalInvested <= 0) {
    return {
      equity_multiple: null, irr_pct: null, roce_pct: null,
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

  // IRR cashflow series: month-over-month deltas of cumulative_cashflow already isolate
  // each month's net movement (capital calls negative, operating cashflow the rest) —
  // starting_cash itself is the baseline, not a new outlay, so it's excluded here.
  const flows = cumulativeCashflows.map((c, i) => c - (i === 0 ? startingCash : cumulativeCashflows[i - 1]))
  if (flows.length > 0) flows[flows.length - 1] += endEquity   // as-if-liquidated terminal value
  const irr_pct = solveIRR(flows)

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

  return { equity_multiple, roce_pct, cash_on_cash_pct, net_yield_on_cost_pct, irr_pct, months_to_payback }
}
