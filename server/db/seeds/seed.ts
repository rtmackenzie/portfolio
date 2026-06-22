import { getDb, transaction } from '../database.ts'

function run() {
  const db = getDb()
  const existing = db.prepare('SELECT COUNT(*) as count FROM properties').get() as { count: number }
  if (existing.count > 0) {
    console.log('[Seed] Data already exists — skipping')
    return
  }

  console.log('[Seed] Inserting demo data...')

  transaction(() => {
    // ── Properties ──────────────────────────────────────────────────────────────
    const insertProp = db.prepare(
      `INSERT INTO properties (address_line1, town, county, postcode, purchase_date, purchase_price,
        current_value, property_type, bedrooms, bathrooms, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    const p1 = insertProp.run('42 Bramhall Lane', 'Stockport', 'Greater Manchester', 'SK7 2DY', '2019-03-15', 185000, 235000, 'house', 3, 1, 'let', 'Semi-detached. Good tenant history.')
    const p2 = insertProp.run('8 Victoria Road', 'Leeds', 'West Yorkshire', 'LS6 1PF', '2021-08-20', 145000, 168000, 'flat', 2, 1, 'let', 'Ground floor flat near university.')
    const p3 = insertProp.run('17 Ecclesall Road', 'Sheffield', 'South Yorkshire', 'S11 8HW', '2020-11-01', 220000, 255000, 'hmo', 5, 2, 'let', 'Licensed HMO. 5 students.')
    const p4 = insertProp.run('3 Cheetham Hill Road', 'Manchester', 'Greater Manchester', 'M8 8AA', '2022-04-10', 162000, 175000, 'house', 3, 1, 'let', 'Terrace. Recently refurbished kitchen.')

    const ids = [p1.lastInsertRowid, p2.lastInsertRowid, p3.lastInsertRowid, p4.lastInsertRowid] as number[]

    // ── Tenants ──────────────────────────────────────────────────────────────────
    const insertTenant = db.prepare(
      `INSERT INTO tenants (property_id, name, email, phone, rent_amount, rent_due_day,
        tenancy_start, tenancy_end, deposit_amount, deposit_scheme, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    const t1 = insertTenant.run(ids[0], 'Sarah Johnson', 'sarah.j@email.com', '07700 900123', 1100, 1, '2021-06-01', null, 1650, 'DPS', 'active')
    const t2 = insertTenant.run(ids[1], 'Marcus Webb', 'marcus.w@email.com', '07700 900456', 850, 1, '2022-09-15', null, 1275, 'MyDeposits', 'active')
    const t3 = insertTenant.run(ids[2], 'HMO Room 1 (5 Rooms)', 'admin@rentmanager.com', '07700 900789', 2200, 1, '2022-01-01', null, 3300, 'TDS', 'active')
    const t4 = insertTenant.run(ids[3], 'David & Emma Clarke', 'dclarke@email.com', '07700 900012', 1050, 1, '2023-02-01', null, 1575, 'DPS', 'active')

    const tids = [t1.lastInsertRowid, t2.lastInsertRowid, t3.lastInsertRowid, t4.lastInsertRowid] as number[]

    // ── Mortgages ─────────────────────────────────────────────────────────────
    const insertMortgage = db.prepare(
      `INSERT INTO mortgages (property_id, lender, original_amount, current_balance, interest_rate,
        monthly_payment, type, fixed_period_end, renewal_date, start_date, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    insertMortgage.run(ids[0], 'Nationwide', 138750, 124000, 4.79, 494, 'fixed', '2026-03-31', '2026-03-31', '2019-04-01', 1)
    insertMortgage.run(ids[1], 'NatWest', 108750, 102000, 5.24, 475, 'fixed', '2025-09-30', '2025-09-30', '2021-09-01', 1)
    insertMortgage.run(ids[2], 'Barclays', 165000, 156000, 5.49, 714, 'fixed', '2026-11-30', '2026-11-30', '2020-12-01', 1)
    insertMortgage.run(ids[3], 'Halifax', 121500, 118000, 5.89, 597, 'tracker', '2027-04-30', '2027-04-30', '2022-05-01', 1)

    // ── Expenses ──────────────────────────────────────────────────────────────
    const insertExpense = db.prepare(
      `INSERT INTO expenses (property_id, category, amount, frequency, description, active)
       VALUES (?, ?, ?, ?, ?, 1)`
    )

    // Property 1
    insertExpense.run(ids[0], 'insurance', 45, 'monthly', 'Landlord insurance — PolicyExpert')
    insertExpense.run(ids[0], 'letting_agent', 110, 'monthly', 'Henderson Properties 10% management')
    insertExpense.run(ids[0], 'ground_rent', 250, 'annually', 'Annual ground rent')

    // Property 2
    insertExpense.run(ids[1], 'insurance', 38, 'monthly', 'Landlord insurance')
    insertExpense.run(ids[1], 'letting_agent', 85, 'monthly', 'Self-managed — Rightmove advertising')
    insertExpense.run(ids[1], 'service_charge', 1200, 'annually', 'Annual service charge')
    insertExpense.run(ids[1], 'ground_rent', 150, 'annually', 'Ground rent')

    // Property 3 — HMO
    insertExpense.run(ids[2], 'insurance', 95, 'monthly', 'HMO specialist insurance')
    insertExpense.run(ids[2], 'letting_agent', 220, 'monthly', 'HMO management 10%')
    insertExpense.run(ids[2], 'utilities', 180, 'monthly', 'Gas/Electric/Water (bills included)')

    // Property 4
    insertExpense.run(ids[3], 'insurance', 40, 'monthly', 'Landlord insurance')
    insertExpense.run(ids[3], 'letting_agent', 105, 'monthly', 'Management fee 10%')

    // Portfolio-wide
    insertExpense.run(null, 'accountancy', 1200, 'annually', 'Annual SA return — Smith & Partners')

    // ── Rent Payments (last 12 months) ───────────────────────────────────────
    const insertPayment = db.prepare(
      `INSERT INTO rent_payments (property_id, tenant_id, amount, due_date, paid_date, status, payment_method)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )

    const today = new Date()
    for (let i = 11; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
      const dueDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
      const paidDate = i > 0 ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-03` : null

      // Property 1 — all paid on time
      insertPayment.run(ids[0], tids[0], 1100, dueDate, paidDate, paidDate ? 'paid' : 'pending', 'standing_order')
      // Property 2 — one late
      const p2Status = i === 5 ? 'late' : paidDate ? 'paid' : 'pending'
      const p2Paid = i === 5 ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-12` : paidDate
      insertPayment.run(ids[1], tids[1], 850, dueDate, p2Paid, p2Status, 'bank_transfer')
      // Property 3
      insertPayment.run(ids[2], tids[2], 2200, dueDate, paidDate, paidDate ? 'paid' : 'pending', 'bank_transfer')
      // Property 4 — one missed 8 months ago
      const p4Status = i === 8 ? 'missed' : paidDate ? 'paid' : 'pending'
      insertPayment.run(ids[3], tids[3], 1050, dueDate, i === 8 ? null : paidDate, p4Status, 'standing_order')
    }

    // ── Certificates ─────────────────────────────────────────────────────────
    const insertCert = db.prepare(
      `INSERT INTO certificates (property_id, type, issue_date, expiry_date, issuer, status)
       VALUES (?, ?, ?, ?, ?, ?)`
    )

    // Property 1
    const gasExpiry1 = new Date(today); gasExpiry1.setDate(today.getDate() + 18)
    insertCert.run(ids[0], 'gas_safety', '2024-08-10', gasExpiry1.toISOString().slice(0,10), 'BritishGas', 'due_soon')
    insertCert.run(ids[0], 'epc', '2021-04-15', '2031-04-15', 'Energy Survey Co', 'valid')
    insertCert.run(ids[0], 'electrical', '2022-06-01', '2027-06-01', 'Safe Electrics Ltd', 'valid')

    // Property 2 — EPC expired
    insertCert.run(ids[1], 'gas_safety', '2024-10-01', '2025-10-01', 'HomeGas Services', 'valid')
    insertCert.run(ids[1], 'epc', '2015-03-01', '2025-03-01', 'Leeds Surveys', 'expired')
    insertCert.run(ids[1], 'eicr', '2022-01-15', '2027-01-15', 'Bright Spark Electrical', 'valid')

    // Property 3 — HMO
    insertCert.run(ids[2], 'gas_safety', '2024-09-15', '2025-09-15', 'Sheffield Gas Co', 'valid')
    insertCert.run(ids[2], 'epc', '2022-11-01', '2032-11-01', 'South Yorkshire Surveys', 'valid')
    insertCert.run(ids[2], 'hmo_licence', '2023-01-01', '2028-01-01', 'Sheffield City Council', 'valid')
    insertCert.run(ids[2], 'fire_risk', '2024-01-10', '2025-01-10', 'FireSafe Ltd', 'valid')

    // Property 4
    insertCert.run(ids[3], 'gas_safety', '2024-11-20', '2025-11-20', 'Manchester Gas', 'valid')
    insertCert.run(ids[3], 'epc', '2022-07-01', '2032-07-01', 'Manchester Surveys', 'valid')

    // ── Maintenance Records ──────────────────────────────────────────────────
    const insertMaint = db.prepare(
      `INSERT INTO maintenance_records (property_id, title, description, category, cost, date, contractor, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )

    insertMaint.run(ids[0], 'Annual boiler service', null, 'heating', 120, '2024-09-15', 'PlumbRight Ltd', 'completed')
    insertMaint.run(ids[0], 'Replace bathroom tap', 'Hot water tap dripping', 'plumbing', 85, '2024-11-02', 'A1 Plumbing', 'completed')
    insertMaint.run(ids[1], 'Fix kitchen extractor fan', 'Stopped working', 'appliance', 45, '2024-10-18', null, 'completed')
    insertMaint.run(ids[2], 'Redecorate Room 3', 'Tenant moved out — full repaint needed', 'cosmetic', 380, '2024-12-01', 'Sheffield Decorators', 'completed')
    insertMaint.run(ids[2], 'Replace washing machine', 'Old machine beyond repair', 'appliance', 349, '2025-01-15', 'AO.com', 'completed')
    insertMaint.run(ids[3], 'Repair front garden fence', 'Damaged in storm', 'structural', 0, today.toISOString().slice(0,10), null, 'pending')
    insertMaint.run(ids[0], 'Check loft insulation', 'Tenant complained of cold', 'structural', 0, today.toISOString().slice(0,10), null, 'in_progress')

    // ── Property Valuations ──────────────────────────────────────────────────
    const insertVal = db.prepare(
      'INSERT INTO property_valuations (property_id, valuation_date, amount, source) VALUES (?, ?, ?, ?)'
    )

    // Add historical valuations for the chart
    insertVal.run(ids[0], '2019-03-15', 185000, 'mortgage_lender')
    insertVal.run(ids[0], '2021-01-01', 205000, 'portal')
    insertVal.run(ids[0], '2023-01-01', 225000, 'estate_agent')
    insertVal.run(ids[0], '2024-01-01', 232000, 'estate_agent')
    insertVal.run(ids[0], '2025-01-01', 235000, 'estate_agent')

    insertVal.run(ids[1], '2021-08-20', 145000, 'mortgage_lender')
    insertVal.run(ids[1], '2023-06-01', 160000, 'portal')
    insertVal.run(ids[1], '2025-01-01', 168000, 'estate_agent')

    insertVal.run(ids[2], '2020-11-01', 220000, 'mortgage_lender')
    insertVal.run(ids[2], '2023-01-01', 242000, 'surveyor')
    insertVal.run(ids[2], '2025-01-01', 255000, 'estate_agent')

    insertVal.run(ids[3], '2022-04-10', 162000, 'mortgage_lender')
    insertVal.run(ids[3], '2024-01-01', 170000, 'portal')
    insertVal.run(ids[3], '2025-01-01', 175000, 'estate_agent')

    // ── Acquisition Opportunities ─────────────────────────────────────────────
    const insertOpp = db.prepare(
      `INSERT INTO acquisition_opportunities (address, town, postcode, stage, property_type, bedrooms,
        asking_price, estimated_value, expected_rent, repair_costs, deposit_percent, mortgage_rate, notes, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    insertOpp.run('22 Beech Avenue', 'Bradford', 'BD3 9LT', 'researching', 'house', 3, 135000, 145000, 900, 5000, 25, 5.5, 'Good area. Near school. Asking below market.', 'Rightmove')
    insertOpp.run('Flat 4, Crown Court', 'Manchester', 'M15 6BH', 'viewing_booked', 'flat', 2, 175000, 178000, 1050, 2000, 25, 5.49, 'City centre flat. High rental demand. Viewing booked 15th Jan.', 'Zoopla')
    insertOpp.run('9 Mill Lane', 'Huddersfield', 'HD1 3QT', 'spotted', 'house', 4, 158000, 162000, 1100, 8000, 25, 5.5, 'Potential HMO conversion. 4 bed. Check planning.', 'OnTheMarket')

    // ── Activity Log ─────────────────────────────────────────────────────────
    const insertLog = db.prepare(
      `INSERT INTO activity_log (event_type, entity_type, entity_id, description, event_date)
       VALUES (?, ?, ?, ?, datetime('now', ?))`
    )

    insertLog.run('rent_received', 'payment', null, 'Rent received — 42 Bramhall Lane, Stockport (£1,100)', '-2 days')
    insertLog.run('rent_received', 'payment', null, 'Rent received — 8 Victoria Road, Leeds (£850)', '-2 days')
    insertLog.run('rent_received', 'payment', null, 'Rent received — 17 Ecclesall Road, Sheffield (£2,200)', '-2 days')
    insertLog.run('rent_received', 'payment', null, 'Rent received — 3 Cheetham Hill Road, Manchester (£1,050)', '-3 days')
    insertLog.run('maintenance_completed', 'maintenance', null, 'Maintenance completed: Replace washing machine — Sheffield', '-5 days')
    insertLog.run('certificate_expiring', 'certificate', null, '⚠️ Gas Safety Certificate expiring in 18 days — 42 Bramhall Lane', '-1 days')
    insertLog.run('certificate_expired', 'certificate', null, '🚨 EPC expired — 8 Victoria Road, Leeds (renewal required)', '-7 days')
    insertLog.run('opportunity_added', 'acquisition', null, 'New opportunity spotted: Flat 4, Crown Court, Manchester', '-10 days')
    insertLog.run('property_updated', 'property', null, 'Valuation updated — 3 Cheetham Hill Road: £175,000', '-14 days')
    insertLog.run('maintenance_logged', 'maintenance', null, 'Maintenance raised: Repair front garden fence — Manchester', '0 hours')
    insertLog.run('tenant_added', 'tenant', null, 'Tenant added: David & Emma Clarke — 3 Cheetham Hill Road', '-365 days')
    insertLog.run('property_created', 'property', null, 'Property added: 3 Cheetham Hill Road, Manchester (£162,000)', '-365 days')

    // ── Base Scenario ─────────────────────────────────────────────────────────
    const scenResult = db.prepare(
      `INSERT INTO scenarios (name, description, base_date, projection_years)
       VALUES (?, ?, ?, ?)`
    ).run('Base Case (No Changes)', 'Current portfolio with no new acquisitions or changes', today.toISOString().slice(0,10), 10)

    const scenario2 = db.prepare(
      `INSERT INTO scenarios (name, description, base_date, projection_years)
       VALUES (?, ?, ?, ?)`
    ).run('Growth Strategy (Buy 2 More)', 'Buy one property in 2025 and another in 2026', today.toISOString().slice(0,10), 10)

    // Add events to growth scenario
    const futureDate1 = new Date(today)
    futureDate1.setMonth(futureDate1.getMonth() + 6)
    const futureDate2 = new Date(today)
    futureDate2.setFullYear(futureDate2.getFullYear() + 1)
    futureDate2.setMonth(futureDate2.getMonth() + 3)

    db.prepare(
      `INSERT INTO scenario_events (scenario_id, event_type, date, parameters_json, sort_order)
       VALUES (?, 'buy_property', ?, ?, 0)`
    ).run(scenario2.lastInsertRowid, futureDate1.toISOString().slice(0,10),
      JSON.stringify({ purchase_price: 175000, monthly_rent: 1050, deposit_percent: 25, mortgage_rate: 5.5, monthly_expenses: 250 }))

    db.prepare(
      `INSERT INTO scenario_events (scenario_id, event_type, date, parameters_json, sort_order)
       VALUES (?, 'buy_property', ?, ?, 1)`
    ).run(scenario2.lastInsertRowid, futureDate2.toISOString().slice(0,10),
      JSON.stringify({ purchase_price: 195000, monthly_rent: 1100, deposit_percent: 25, mortgage_rate: 5.5, monthly_expenses: 280 }))
  })

  console.log('[Seed] ✅ Demo data inserted successfully')
  console.log('[Seed]    4 properties, 4 tenants, 4 mortgages')
  console.log('[Seed]    12 months rent payments, certificates, maintenance, valuations')
  console.log('[Seed]    3 pipeline opportunities, 2 scenarios, 12 activity log entries')
}

run()
