export function calcLBTT(price: number): number {
  if (price <= 0) return 0
  const bands = [
    { limit: 145000, rate: 0.00 },
    { limit: 250000, rate: 0.02 },
    { limit: 325000, rate: 0.05 },
    { limit: 750000, rate: 0.10 },
    { limit: Infinity, rate: 0.12 },
  ]
  let tax = 0, prev = 0
  for (const { limit, rate } of bands) {
    if (price <= prev) break
    tax += (Math.min(price, limit) - prev) * rate
    prev = limit
  }
  return Math.round(tax)
}

export function calcADS(price: number): number {
  return price > 40000 ? Math.round(price * 0.08) : 0
}

export function calcTransactionCosts(
  price: number,
  legalFees = 2000,
  refurbCosts = 0
): { lbtt: number; ads: number; fees: number; total: number } {
  const lbtt = calcLBTT(price)
  const ads = calcADS(price)
  const fees = legalFees + refurbCosts
  return { lbtt, ads, fees, total: lbtt + ads + fees }
}

export function calcGrossYield(annualRent: number, propertyValue: number): number {
  if (!propertyValue) return 0
  return Math.round((annualRent / propertyValue) * 1000) / 10
}

export function calcNetCashflow(monthlyRent: number, monthlyMortgage: number, monthlyExpenses: number): number {
  return monthlyRent - monthlyMortgage - monthlyExpenses
}

export function calcDepositRequired(purchasePrice: number, depositPercent: number, repairCosts = 0): number {
  return purchasePrice * (depositPercent / 100) + repairCosts
}

export function calcMonthlyMortgage(loanAmount: number, annualRate: number, termMonths?: number): number {
  if (!termMonths) return (loanAmount * (annualRate / 100)) / 12
  const r = annualRate / 100 / 12
  if (r === 0) return loanAmount / termMonths
  const factor = Math.pow(1 + r, termMonths)
  return loanAmount * (r * factor) / (factor - 1)
}

export function calcAcquisitionMetrics(params: {
  asking_price?: number
  estimated_value?: number
  expected_rent?: number
  repair_costs?: number
  deposit_percent?: number
  mortgage_rate?: number
}) {
  const purchasePrice = params.asking_price ?? 0
  const estimatedValue = params.estimated_value ?? purchasePrice
  const monthlyRent = params.expected_rent ?? 0
  const repairCosts = params.repair_costs ?? 0
  const depositPercent = params.deposit_percent ?? 25
  const mortgageRate = params.mortgage_rate ?? 5.5

  const depositAmount = purchasePrice * (depositPercent / 100)
  const mortgageAmount = purchasePrice - depositAmount
  const monthlyMortgagePayment = (mortgageAmount * (mortgageRate / 100)) / 12
  const totalInvested = depositAmount + repairCosts
  const grossYield = estimatedValue > 0 ? (monthlyRent * 12 / estimatedValue) * 100 : 0
  const netCashflow = monthlyRent - monthlyMortgagePayment
  const roi = totalInvested > 0 ? ((netCashflow * 12) / totalInvested) * 100 : 0

  return {
    deposit_required: Math.round(depositAmount),
    mortgage_amount: Math.round(mortgageAmount),
    monthly_mortgage: Math.round(monthlyMortgagePayment * 100) / 100,
    gross_yield: Math.round(grossYield * 10) / 10,
    net_cashflow: Math.round(netCashflow * 100) / 100,
    roi: Math.round(roi * 10) / 10,
    potential_equity: Math.round(estimatedValue - purchasePrice),
    total_invested: Math.round(totalInvested),
  }
}
