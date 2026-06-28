import express from 'express'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { runMigrations } from './db/migrate.ts'
import dashboardRouter from './routes/dashboard.ts'
import propertiesRouter from './routes/properties.ts'
import tenantsRouter from './routes/tenants.ts'
import mortgagesRouter from './routes/mortgages.ts'
import financesRouter from './routes/finances.ts'
import maintenanceRouter from './routes/maintenance.ts'
import certificatesRouter from './routes/certificates.ts'
import documentsRouter from './routes/documents.ts'
import acquisitionsRouter from './routes/acquisitions.ts'
import scenariosRouter from './routes/scenarios.ts'
import reportsRouter from './routes/reports.ts'
import goalsRouter from './routes/goals.ts'
import settingsRouter from './routes/settings.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT ?? 3002
const isDev = process.env.NODE_ENV !== 'production'

app.use(express.json())

runMigrations()

app.use('/api/dashboard', dashboardRouter)
app.use('/api/properties', propertiesRouter)
app.use('/api/tenants', tenantsRouter)
app.use('/api/mortgages', mortgagesRouter)
app.use('/api/finances', financesRouter)
app.use('/api/maintenance', maintenanceRouter)
app.use('/api/certificates', certificatesRouter)
app.use('/api/documents', documentsRouter)
app.use('/api/acquisitions', acquisitionsRouter)
app.use('/api/scenarios', scenariosRouter)
app.use('/api/reports', reportsRouter)
app.use('/api/goals', goalsRouter)
app.use('/api/settings', settingsRouter)

if (!isDev) {
  const distPath = join(__dirname, '..', 'dist')
  app.use(express.static(distPath))
  app.get('*', (_req, res) => {
    res.sendFile(join(distPath, 'index.html'))
  })
}

app.listen(PORT, () => {
  console.log(`[Server] Running on http://localhost:${PORT}`)
  if (isDev) console.log('[Server] Dev mode — React served by Vite on :5174')
})
