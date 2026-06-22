import { Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './layouts/AppLayout'
import Dashboard from './pages/Dashboard'
import Portfolio from './pages/Portfolio'
import PropertyDetail from './pages/PropertyDetail'
import Financials from './pages/Financials'
import Calendar from './pages/Calendar'
import Acquisitions from './pages/Acquisitions'
import Scenarios from './pages/Scenarios'
import BusinessOverview from './pages/BusinessOverview'
import Reports from './pages/Reports'

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/portfolio/:id" element={<PropertyDetail />} />
        <Route path="/financials" element={<Financials />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/acquisitions" element={<Acquisitions />} />
        <Route path="/scenarios" element={<Scenarios />} />
        <Route path="/business" element={<BusinessOverview />} />
        <Route path="/reports" element={<Reports />} />
      </Route>
    </Routes>
  )
}
