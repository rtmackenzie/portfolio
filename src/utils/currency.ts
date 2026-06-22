export function formatCurrency(amount: number, compact = false): string {
  if (compact) {
    if (Math.abs(amount) >= 1_000_000) return `£${(amount / 1_000_000).toFixed(2)}m`
    if (Math.abs(amount) >= 1_000) return `£${(amount / 1_000).toFixed(1)}k`
  }
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-GB').format(value)
}
