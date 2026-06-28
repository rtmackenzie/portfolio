import { Router } from 'express'
import { getSettings, updateSettings } from '../services/settings.ts'
import { DEFAULT_TAX_SETTINGS, type TaxSettings } from '../services/tax.ts'

const router = Router()

router.get('/', (_req, res) => {
  try {
    res.json(getSettings())
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

router.put('/', (req, res) => {
  try {
    const d = req.body as Partial<TaxSettings>
    const current = getSettings()
    // Merge over current so partial updates are safe
    const next: TaxSettings = {
      ownership: d.ownership ?? current.ownership,
      personal_marginal_rate_pct: d.personal_marginal_rate_pct ?? current.personal_marginal_rate_pct,
      s24_credit_rate_pct: d.s24_credit_rate_pct ?? current.s24_credit_rate_pct,
      corp_tax_rate_pct: d.corp_tax_rate_pct ?? current.corp_tax_rate_pct,
      cgt_rate_pct: d.cgt_rate_pct ?? current.cgt_rate_pct,
      cgt_annual_exempt: d.cgt_annual_exempt ?? current.cgt_annual_exempt,
      selling_costs_pct: d.selling_costs_pct ?? current.selling_costs_pct,
    }
    if (next.ownership !== 'personal' && next.ownership !== 'ltd') {
      next.ownership = DEFAULT_TAX_SETTINGS.ownership
    }
    res.json(updateSettings(next))
  } catch (err) {
    res.status(500).json({ message: String(err) })
  }
})

export default router
