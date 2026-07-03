import { describe, it, expect } from 'vitest'
import {
  solveIRR, computeReturnMetrics, computeMIRR, buildInvestorFlows, isFrontLoaded,
  type InvestorFlowInputs,
} from '../../server/services/returnMetrics.ts'

describe('solveIRR', () => {
  it('solves a textbook annual cashflow series to a known IRR', () => {
    // -100 now, +110 one period later → 10% for that single period.
    // Treating each entry as one "month" here (bisection is period-agnostic),
    // annualizing a single-period 10% via (1.10)^12-1 is huge, so instead verify
    // against a multi-period series with a well-known monthly rate.
    const monthlyRate = 0.01                      // 1%/month
    const cashflows = [-1000, ...Array(11).fill(0), 1000 * Math.pow(1 + monthlyRate, 12)]
    const irr = solveIRR(cashflows)
    const expectedAnnual = Math.round((Math.pow(1 + monthlyRate, 12) - 1) * 10000) / 100
    expect(irr).not.toBeNull()
    expect(irr!).toBeCloseTo(expectedAnnual, 0)
  })

  it('returns null when there is no sign change (all positive)', () => {
    expect(solveIRR([100, 100, 100])).toBeNull()
  })

  it('returns null when there is no sign change (all negative)', () => {
    expect(solveIRR([-100, -100, -100])).toBeNull()
  })

  it('returns null for a degenerate single-value series', () => {
    expect(solveIRR([100])).toBeNull()
  })
})

describe('computeReturnMetrics', () => {
  it('returns all-null metrics when no capital has been invested', () => {
    const m = computeReturnMetrics([1000, 1000, 1000], 1000, 0, 0, 0, 0, 1000, 1)
    expect(m).toEqual({
      equity_multiple: null, irr_pct: null, irr_basis: null, roce_pct: null,
      cash_on_cash_pct: null, net_yield_on_cost_pct: null, months_to_payback: null,
    })
  })

  it('computes equity multiple, cash-on-cash and net-yield-on-cost from simple inputs', () => {
    // £50,000 invested; £10,000 net operating cashflow received over the hold; ended with
    // £60,000 equity → 1.4x. totalCashflowPosttax is the RAW ending cumulative_cashflow_posttax
    // (nets capital invested together with operating cashflow), so with startingCash 0 it's
    // (operatingCashReceived - totalCapitalInvested) = 10000 - 50000 = -40000.
    const m = computeReturnMetrics(
      [-50000, -49000, -48000, 60000],   // cumulative cashflow series (illustrative)
      0,          // starting cash
      50000,      // total capital invested
      -40000,     // ending cumulative_cashflow_posttax
      500,        // ending monthly cashflow (post-tax)
      1200,       // ending monthly rent
      60000,      // ending equity
      5           // years held
    )
    expect(m.equity_multiple).toBe(1.4)
    expect(m.cash_on_cash_pct).toBe(Math.round((500 * 12 / 50000) * 10000) / 100)
    expect(m.net_yield_on_cost_pct).toBe(Math.round((1200 * 12 / 50000) * 10000) / 100)
    expect(m.roce_pct).toBe(Math.round(((1.4 - 1) / 5) * 10000) / 100)
  })

  it('finds months_to_payback from the cash-position trough, not a premature positive reading', () => {
    // Starts at 0, dips to -50000 after a purchase, then recovers past 0 by month 4.
    const cumulative = [500, -49500, -30000, -10000, 5000]
    const m = computeReturnMetrics(cumulative, 0, 50000, 0, 0, 0, 0, 5)
    expect(m.months_to_payback).toBe(4)
  })
})

// A single capital call at month 0, no director loans, and a portfolio held with exactly
// break-even monthly operating cashflow (cumulative_cashflow never moves after month 0) —
// the one case where the old diff-based construction and the new capital-account
// construction are guaranteed to produce byte-identical flow series (Appendix C.3: "the two
// constructions coincide when there are no contributions mid-stream").
function frontLoadedScenario() {
  const months = 24
  const totalCapitalInvested = 50000
  const endEquity = 75000
  const cumulativeCashflows = new Array(months).fill(-totalCapitalInvested)
  const investorFlowInputs: InvestorFlowInputs = {
    capitalDeployed: [totalCapitalInvested, ...new Array(months - 1).fill(0)],
    directorLoanIn: new Array(months).fill(0),
    directorLoanRepay: new Array(months).fill(0),
  }
  return { months, totalCapitalInvested, endEquity, cumulativeCashflows, investorFlowInputs }
}

describe('IRR fallback ladder (§P1-4 / Appendix C)', () => {
  it('cross-check invariant: capital-account IRR matches the old diff-based construction when there is no drip funding', () => {
    const { months, totalCapitalInvested, endEquity, cumulativeCashflows, investorFlowInputs } = frontLoadedScenario()

    const m = computeReturnMetrics(
      cumulativeCashflows, 0, totalCapitalInvested, -totalCapitalInvested, 0, 0, endEquity, months / 12,
      investorFlowInputs
    )

    // The old (pre-§P1-4) construction: diff cumulative_cashflow month-over-month, append
    // endEquity at the end. Reproduced here (not re-imported — it was retired) purely as the
    // invariant's reference calculation.
    const oldFlows = cumulativeCashflows.map((c, i) => c - (i === 0 ? 0 : cumulativeCashflows[i - 1]))
    oldFlows[oldFlows.length - 1] += endEquity
    const oldIrr = solveIRR(oldFlows)

    expect(m.irr_basis).toBe('capital_account')
    expect(m.irr_pct).not.toBeNull()
    expect(oldIrr).not.toBeNull()
    expect(m.irr_pct!).toBeCloseTo(oldIrr!, 1)
  })

  it('consistency invariant: (1+IRR)^years reconciles with the equity multiple for a front-loaded plan', () => {
    const { months, totalCapitalInvested, endEquity, cumulativeCashflows, investorFlowInputs } = frontLoadedScenario()
    const years = months / 12
    const m = computeReturnMetrics(
      cumulativeCashflows, 0, totalCapitalInvested, -totalCapitalInvested, 0, 0, endEquity, years,
      investorFlowInputs
    )
    expect(m.irr_basis).toBe('capital_account')
    const impliedMultiple = Math.pow(1 + m.irr_pct! / 100, years)
    expect(impliedMultiple).toBeCloseTo(m.equity_multiple!, 1)
  })

  it('falls back to MIRR when the capital-account flows have no bracketable root', () => {
    // A tiny early outflow against a long run of modest positive flows — solveIRR's bisection
    // bracket fails (npv same-signed at both ends) even though the series is sign-mixed; this
    // exercises the tier-2 fallback path deterministically. Magnitudes are synthetic, chosen to
    // hit the fallback, not to represent a realistic plan.
    const capitalDeployed = [500, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    const directorLoanIn = new Array(12).fill(0)
    const directorLoanRepay = [0, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000]
    const flows = buildInvestorFlows({ capitalDeployed, directorLoanIn, directorLoanRepay }, 0, 0)
    expect(solveIRR(flows)).toBeNull()   // confirms this really does exercise the fallback

    const investorFlowInputs: InvestorFlowInputs = { capitalDeployed, directorLoanIn, directorLoanRepay }
    const m = computeReturnMetrics(
      new Array(12).fill(-500), 0, 500, -500, 0, 0, 0, 1,
      investorFlowInputs
    )
    expect(m.irr_basis).toBe('mirr')
    expect(m.irr_pct).not.toBeNull()
    expect(Number.isFinite(m.irr_pct)).toBe(true)
  })

  it('falls back to an annualised equity multiple when there is no per-month investor-flow data at all', () => {
    const m = computeReturnMetrics([-50000, -49000, -48000, 60000], 0, 50000, -40000, 500, 1200, 60000, 5)
    expect(m.irr_basis).toBe('annualised_multiple')
    expect(m.irr_pct).toBe(Math.round((Math.pow(m.equity_multiple!, 1 / 5) - 1) * 10000) / 100)
  })
})

describe('isFrontLoaded', () => {
  it('is true for a single negative block followed by non-negative flows', () => {
    expect(isFrontLoaded([-100, 0, 50, 50, 200])).toBe(true)
  })

  it('is false for a drip-funded series (negative flows recurring after a positive one)', () => {
    expect(isFrontLoaded([-100, 50, -80, 50, 200])).toBe(false)
  })
})

describe('computeMIRR', () => {
  it('resolves a value for a series solveIRR cannot bracket', () => {
    const flows = [-100, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000]
    expect(solveIRR(flows)).toBeNull()
    expect(computeMIRR(flows, 5.5, 0)).not.toBeNull()
  })

  it('returns null for a degenerate series with no negative flow', () => {
    expect(computeMIRR([100, 100, 100], 5.5, 0)).toBeNull()
  })

  it('returns null for a degenerate series with no positive flow', () => {
    expect(computeMIRR([-100, -100, -100], 5.5, 0)).toBeNull()
  })
})
