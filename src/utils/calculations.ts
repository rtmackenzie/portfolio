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

export function calcMonthlyMortgage(loanAmount: number, annualRate: number): number {
  return (loanAmount * (annualRate / 100)) / 12
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
