import { useState, useEffect } from 'react'
import { useSettings, useUpdateSettings } from '@/hooks/useSettings'
import type { TaxSettings } from '@/types'

const taxInputCls = 'w-full px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary'
const taxLabelCls = 'block text-xs font-medium text-muted-foreground mb-1'

function TaxSettingsCard() {
  const { data: settings } = useSettings()
  const update = useUpdateSettings()
  const [form, setForm] = useState<TaxSettings | null>(null)

  useEffect(() => { if (settings) setForm(settings) }, [settings])
  if (!form) return null

  const set = <K extends keyof TaxSettings>(k: K, v: TaxSettings[K]) => setForm({ ...form, [k]: v })
  const num = (k: keyof TaxSettings) => (
    <input type="number" step="0.1" value={form[k] as number}
      onChange={e => set(k, Number(e.target.value) as never)} className={taxInputCls} />
  )

  return (
    <div className="bg-card rounded-lg p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Tax settings</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Applied to all What-If projections and goal pathways. Drives the post-tax cashflow.</p>
        </div>
        <button
          onClick={() => update.mutate(form)}
          disabled={update.isPending}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium disabled:opacity-50"
        >
          {update.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="col-span-2">
          <label className={taxLabelCls}>Ownership structure</label>
          <select value={form.ownership} onChange={e => set('ownership', e.target.value as TaxSettings['ownership'])} className={taxInputCls}>
            <option value="personal">Personal (S24 — individual landlord)</option>
            <option value="ltd">Limited company (corporation tax)</option>
          </select>
        </div>

        {form.ownership === 'personal' ? (
          <>
            <div><label className={taxLabelCls}>Marginal income-tax rate (%)</label>{num('personal_marginal_rate_pct')}</div>
            <div><label className={taxLabelCls}>S24 interest credit (%)</label>{num('s24_credit_rate_pct')}</div>
            <div><label className={taxLabelCls}>CGT rate (%)</label>{num('cgt_rate_pct')}</div>
            <div><label className={taxLabelCls}>CGT annual exemption (£)</label>{num('cgt_annual_exempt')}</div>
            <div><label className={taxLabelCls}>Selling costs (% of sale)</label>{num('selling_costs_pct')}</div>
          </>
        ) : (
          <>
            <div><label className={taxLabelCls}>Corporation tax rate (%)</label>{num('corp_tax_rate_pct')}</div>
            <div><label className={taxLabelCls}>Selling costs (% of sale)</label>{num('selling_costs_pct')}</div>
            <div className="col-span-4 text-xs text-muted-foreground">Company gains are taxed via corporation tax (no CGT allowance). Mortgage interest is fully deductible.</div>
          </>
        )}
      </div>
    </div>
  )
}

export default function Settings() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Configuration that applies across the app</p>
      </div>
      <TaxSettingsCard />
    </div>
  )
}
