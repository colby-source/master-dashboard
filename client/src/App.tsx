import { Routes, Route } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { CommandPalette } from './components/CommandPalette'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Toaster } from './components/ui/sonner'
import { useWebSocket } from './hooks/use-websocket'
import { useCompanyFilter } from './hooks/use-company-filter'
import { CompanyContext } from './contexts/CompanyContext'

import DashboardPage from './pages/DashboardPage'
import CampaignsPage from './pages/CampaignsPage'
import OutboundPage from './pages/OutboundPage'
import CampaignWriterPage from './pages/CampaignWriterPage'
import ContactsPage from './pages/ContactsPage'
import ContactDetailPage from './pages/ContactDetailPage'
import EnrichmentPage from './pages/EnrichmentPage'
import PipelinesPage from './pages/PipelinesPage'
import AgentsPage from './pages/AgentsPage'
import TasksPage from './pages/TasksPage'
import AnalyticsPage from './pages/AnalyticsPage'
import SettingsPage from './pages/SettingsPage'
import MetaAdsPage from './pages/MetaAdsPage'
import LinkedInPage from './pages/LinkedInPage'
import InstagramPage from './pages/InstagramPage'
import WhatsAppPage from './pages/WhatsAppPage'
import DiscoveriesPage from './pages/DiscoveriesPage'
import CompetitorsPage from './pages/CompetitorsPage'
import ScrapingPage from './pages/ScrapingPage'
import OpenClawPage from './pages/OpenClawPage'
import CampaignDetailPage from './pages/CampaignDetailPage'
import BtrPage from './pages/BtrPage'
import DomainHealthPage from './pages/DomainHealthPage'
import GuidePage from './pages/GuidePage'
import AiAssistantPage from './pages/AiAssistantPage'
import Rb2bPage from './pages/Rb2bPage'
import LookupPage from './pages/LookupPage'
import ReportsPage from './pages/ReportsPage'
import GhlCommandPage from './pages/GhlCommandPage'
import AbTestingPage from './pages/AbTestingPage'
import MeetingTranscriptsPage from './pages/MeetingTranscriptsPage'

export default function App() {
  const { companyId, setCompanyId, companies } = useCompanyFilter()
  useWebSocket()

  return (
    <CompanyContext.Provider value={{ companyId, setCompanyId, companies }}>
      <div className="min-h-screen bg-background text-foreground">
        <CommandPalette />
        <Toaster position="bottom-right" richColors />
        <ErrorBoundary fallbackMessage="The application encountered an error. Click Try Again to reload.">
          <Routes>
            <Route element={<AppShell companyId={companyId} onCompanyChange={setCompanyId} companies={companies} />}>
              <Route index element={<DashboardPage />} />
              <Route path="campaigns" element={<CampaignsPage />} />
              <Route path="campaigns/:id" element={<CampaignDetailPage />} />
              <Route path="outbound" element={<OutboundPage />} />
              <Route path="writer" element={<CampaignWriterPage />} />
              <Route path="contacts" element={<ContactsPage />} />
              <Route path="contacts/:id" element={<ContactDetailPage />} />
              <Route path="enrichment" element={<EnrichmentPage />} />
              <Route path="pipelines" element={<PipelinesPage />} />
              <Route path="agents" element={<AgentsPage />} />
              <Route path="tasks" element={<TasksPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="meta-ads" element={<MetaAdsPage />} />
              <Route path="linkedin" element={<LinkedInPage />} />
              <Route path="instagram" element={<InstagramPage />} />
              <Route path="whatsapp" element={<WhatsAppPage />} />
              <Route path="discoveries" element={<DiscoveriesPage />} />
              <Route path="competitors" element={<CompetitorsPage />} />
              <Route path="scraping" element={<ScrapingPage />} />
              <Route path="openclaw" element={<OpenClawPage />} />
              <Route path="btr" element={<BtrPage />} />
              <Route path="domain-health" element={<DomainHealthPage />} />
              <Route path="guide" element={<GuidePage />} />
              <Route path="ai-assistant" element={<AiAssistantPage />} />
              <Route path="rb2b" element={<Rb2bPage />} />
              <Route path="lookup" element={<LookupPage />} />
              <Route path="reports" element={<ReportsPage />} />
              <Route path="ghl" element={<GhlCommandPage />} />
              <Route path="ab-testing" element={<AbTestingPage />} />
              <Route path="meeting-transcripts" element={<MeetingTranscriptsPage />} />
            </Route>
          </Routes>
        </ErrorBoundary>
      </div>
    </CompanyContext.Provider>
  )
}
