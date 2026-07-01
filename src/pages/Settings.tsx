import { useState, useEffect } from 'react'
import { useSettings, useUpdateSettings } from '@/hooks/useSettings'
import type { TaxSettings, AssumptionSettings } from '@/types'

const taxInputCls = 'w-full px-3 py-2 rounded-md bg-input border border-border text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary'
const taxLabelCls = 'block text-xs font-medium text-muted-foreground mb-1'

// Hover tooltip wrapper. Uses React state, not CSS group-hover (which doesn't
// work in this project's Tailwind v4 setup). Renders an inline dotted-underline
// span with an absolutely-positioned popover above it.
function Tip({ text, children, className = '' }: { text: string; children: string; className?: string }) {
  const [show, setShow] = useState(false)
  return (
    <span className={`relative ${className}`}>
      <span
        className="underline decoration-dotted decoration-muted-foreground/40 cursor-default"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      >
        {children}
      </span>
      {show && (
        <div className="absolute bottom-full left-0 mb-1 w-56 rounded-md bg-popover border border-border text-xs font-normal normal-case text-popover-foreground p-2 shadow-lg z-50 whitespace-normal leading-relaxed">
          {text}
        </div>
      )}
    </span>
  )
}

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
          <label className={taxLabelCls}><Tip text="Whether properties are held personally or through a limited company. Drives which tax fields apply and how mortgage interest and disposal gains are taxed.">Ownership structure</Tip></label>
          <select value={form.ownership} onChange={e => set('ownership', e.target.value as TaxSettings['ownership'])} className={taxInputCls}>
            <option value="personal">Personal (S24 — individual landlord)</option>
            <option value="ltd">Limited company (corporation tax)</option>
          </select>
        </div>

        {form.ownership === 'personal' ? (
          <>
            <div><label className={taxLabelCls}><Tip text="Your marginal income-tax rate. Applied to rental profit after the Section 24 interest credit.">Marginal income-tax rate (%)</Tip></label>{num('personal_marginal_rate_pct')}</div>
            <div><label className={taxLabelCls}><Tip text="The Section 24 basic-rate tax credit on mortgage interest — interest isn't deductible for personal landlords, but this credit offsets some of the tax. Typically 20%.">S24 interest credit (%)</Tip></label>{num('s24_credit_rate_pct')}</div>
            <div><label className={taxLabelCls}><Tip text="Capital Gains Tax rate applied to the taxable gain on a disposal, above the annual exemption.">CGT rate (%)</Tip></label>{num('cgt_rate_pct')}</div>
            <div><label className={taxLabelCls}><Tip text="The tax-free CGT allowance applied per disposal before the CGT rate kicks in.">CGT annual exemption (£)</Tip></label>{num('cgt_annual_exempt')}</div>
            <div><label className={taxLabelCls}><Tip text="Agent and legal fees on sale, as a % of sale price. Reduces net proceeds and the taxable gain.">Selling costs (% of sale)</Tip></label>{num('selling_costs_pct')}</div>
          </>
        ) : (
          <>
            <div><label className={taxLabelCls}><Tip text="Corporation tax rate applied to retained profit (rent minus expenses and interest — fully deductible for a company).">Corporation tax rate (%)</Tip></label>{num('corp_tax_rate_pct')}</div>
            <div><label className={taxLabelCls}><Tip text="Agent and legal fees on sale, as a % of sale price. Reduces net proceeds and the taxable gain.">Selling costs (% of sale)</Tip></label>{num('selling_costs_pct')}</div>
            <div className="col-span-4 text-xs text-muted-foreground">Company gains are taxed via corporation tax (no CGT allowance). Mortgage interest is fully deductible.</div>
          </>
        )}
      </div>
    </div>
  )
}

function AssumptionSettingsCard() {
  const { data: settings } = useSettings()
  const update = useUpdateSettings()
  const [form, setForm] = useState<AssumptionSettings | null>(null)

  useEffect(() => { if (settings) setForm(settings) }, [settings])
  if (!form) return null

  const set = <K extends keyof AssumptionSettings>(k: K, v: AssumptionSettings[K]) => setForm({ ...form, [k]: v })
  const num = (k: keyof AssumptionSettings, step = '0.1') => (
    <input type="number" step={step} value={form[k] as number}
      onChange={e => set(k, Number(e.target.value) as never)} className={taxInputCls} />
  )

  return (
    <div className="bg-card rounded-lg p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Assumptions</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Default deal terms, growth/inflation rates and lender stress test used whenever a scenario or goal pathway doesn't specify its own value.</p>
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
        <div><label className={taxLabelCls}><Tip text="Deposit % used for a new purchase whenever a scenario or goal pathway doesn't specify its own deposit.">Default deposit (%)</Tip></label>{num('default_deposit_percent')}</div>
        <div><label className={taxLabelCls}><Tip text="Mortgage interest rate assumed for a new purchase whenever a scenario or goal pathway doesn't specify its own rate.">Default mortgage rate (%)</Tip></label>{num('default_mortgage_rate_pct')}</div>
        <div><label className={taxLabelCls}><Tip text="Legal and survey fees assumed on a new purchase whenever not specified.">Default legal fees (£)</Tip></label>{num('default_legal_fees', '1')}</div>
        <div><label className={taxLabelCls}><Tip text="Mortgage product/arrangement fee assumed on a new purchase whenever not specified.">Default arrangement fee (£)</Tip></label>{num('default_arrangement_fee', '1')}</div>
        <div><label className={taxLabelCls}><Tip text="Lender valuation/survey fee assumed on a new purchase whenever not specified.">Default valuation fee (£)</Tip></label>{num('default_valuation_fee', '1')}</div>
        <div><label className={taxLabelCls}><Tip text="Annual property value growth rate used across projections, unless a scenario overrides it.">Property growth (%/yr)</Tip></label>{num('default_property_growth_pct')}</div>
        <div><label className={taxLabelCls}><Tip text="Annual rent growth rate used across projections, unless a scenario overrides it.">Rent growth (%/yr)</Tip></label>{num('default_rent_growth_pct')}</div>
        <div><label className={taxLabelCls}><Tip text="Annual inflation rate applied to running expenses, unless a scenario overrides it.">Expense inflation (%/yr)</Tip></label>{num('default_expense_inflation_pct')}</div>
        <div><label className={taxLabelCls}><Tip text="Average void (vacant) months per year assumed per property, reducing effective rent.">Void (months/yr)</Tip></label>{num('default_void_months_per_year')}</div>
        <div><label className={taxLabelCls}><Tip text="Rate uplift added to the mortgage pay-rate for the lender ICR stress test (200 = +2%).">ICR stress uplift (bps)</Tip></label>{num('icr_stress_uplift_bps', '1')}</div>
        <div><label className={taxLabelCls}><Tip text="Minimum stress rate used for the lender ICR test, regardless of the actual pay rate.">ICR stress rate floor (%)</Tip></label>{num('icr_stress_floor_pct')}</div>
        <div className="col-span-4 text-xs text-muted-foreground">The lender ICR stress test uses the higher of (mortgage rate + uplift) and the floor.</div>
        <div><label className={taxLabelCls}><Tip text="How often each property incurs a lumpy capex cost (boiler, roof, kitchens). Mirrors the mortgage-reprice schedule — a lump sum every N years per property.">Capex cycle (years)</Tip></label>{num('capex_cycle_years', '1')}</div>
        <div><label className={taxLabelCls}><Tip text="The lump-sum cost charged per property at each capex cycle.">Capex cost per property (£)</Tip></label>{num('capex_cost_per_property', '1')}</div>
        <div><label className={taxLabelCls}><Tip text="Rent arrears/bad debt as a % of rent, reducing effective rent every month — distinct from void (vacancy).">Rent arrears (% of rent)</Tip></label>{num('arrears_pct')}</div>
        <div className="col-span-4 text-xs text-muted-foreground">Every property incurs a lump-sum capex cost (boiler/roof/kitchens) each cycle. Arrears reduces effective rent every month, distinct from void.</div>
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
      <AssumptionSettingsCard />
    </div>
  )
}
