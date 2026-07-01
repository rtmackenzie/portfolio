import { describe, it, expect } from 'vitest'
import { solveIRR, computeReturnMetrics } from '../../server/services/returnMetrics.ts'

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
      equity_multiple: null, irr_pct: null, roce_pct: null,
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
