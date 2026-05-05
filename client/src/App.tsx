import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import { AppShell } from './components/layout/AppShell'
import { CommandPalette } from './components/CommandPalette'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Toaster } from './components/ui/sonner'
import { useWebSocket } from './hooks/use-websocket'
import { useCompanyFilter } from './hooks/use-company-filter'
import { CompanyContext } from './contexts/CompanyContext'

// ── New hero pages ──────────────────────────────────────────
const PipelinePage = lazy(() => import('./pages/PipelinePage'))
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage'))
const LearningPage = lazy(() => import('./pages/LearningPage'))
const DataInventoryPage = lazy(() => import('./pages/DataInventoryPage'))

// ── Active pages (lazy-loaded) ──────────────────────────────
// Dashboard
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const AiAssistantPage = lazy(() => import('./pages/AiAssistantPage'))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'))

// Outbound
const CampaignsPage = lazy(() => import('./pages/CampaignsPage'))
const CampaignDetailPage = lazy(() => import('./pages/CampaignDetailPage'))
const OutboundPage = lazy(() => import('./pages/OutboundPage'))
const DomainHealthPage = lazy(() => import('./pages/DomainHealthPage'))
const ReplyReviewPage = lazy(() => import('./pages/ReplyReviewPage'))

// CRM
const ContactsPage = lazy(() => import('./pages/ContactsPage'))
const ContactDetailPage = lazy(() => import('./pages/ContactDetailPage'))
const EnrichmentPage = lazy(() => import('./pages/EnrichmentPage'))
const PipelinesPage = lazy(() => import('./pages/PipelinesPage'))
const GhlCommandPage = lazy(() => import('./pages/GhlCommandPage'))

// Intelligence
const AdIntelligencePage = lazy(() => import('./pages/AdIntelligencePage'))
const MetaAdsPage = lazy(() => import('./pages/MetaAdsPage'))
const CompetitorsPage = lazy(() => import('./pages/CompetitorsPage'))
const DiscoveriesPage = lazy(() => import('./pages/DiscoveriesPage'))
const Gpf2OpsPage = lazy(() => import('./pages/Gpf2OpsPage'))
const GpcPipelinePage = lazy(() => import('./pages/GpcPipelinePage'))

// System
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const GuidePage = lazy(() => import('./pages/GuidePage'))

// Brand Launchpad
const LaunchpadAdminPage = lazy(() => import('./pages/LaunchpadAdminPage'))
const LaunchpadPublicPage = lazy(() => import('./pages/LaunchpadPublicPage'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  )
}

export default function App() {
  const { companyId, setCompanyId, companies } = useCompanyFilter()
  useWebSocket()

  return (
    <CompanyContext.Provider value={{ companyId, setCompanyId, companies }}>
      <div className="min-h-screen bg-background text-foreground">
        <CommandPalette />
        <Toaster position="bottom-right" richColors />
        <ErrorBoundary fallbackMessage="The application encountered an error. Click Try Again to reload.">
          <Suspense fallback={<PageLoader />}>
            <Routes>
              {/* Public Launchpad — magic-link gated, NO admin chrome */}
              <Route path="launchpad/:token" element={<LaunchpadPublicPage />} />

              <Route element={<AppShell companyId={companyId} onCompanyChange={setCompanyId} companies={companies} />}>
                {/* Dashboard / Hero */}
                <Route index element={<PipelinePage />} />
                <Route path="dashboard-old" element={<DashboardPage />} />
                <Route path="ai-assistant" element={<AiAssistantPage />} />
                <Route path="analytics" element={<AnalyticsPage />} />

                {/* Outbound */}
                <Route path="campaigns" element={<CampaignsPage />} />
                <Route path="campaigns/:id" element={<CampaignDetailPage />} />
                <Route path="outbound" element={<OutboundPage />} />
                <Route path="domain-health" element={<DomainHealthPage />} />
                <Route path="reply-review" element={<ReplyReviewPage />} />

                {/* CRM */}
                <Route path="contacts" element={<ContactsPage />} />
                <Route path="contacts/:id" element={<ContactDetailPage />} />
                <Route path="enrichment" element={<EnrichmentPage />} />
                <Route path="pipelines" element={<PipelinesPage />} />
                <Route path="ghl" element={<GhlCommandPage />} />

                {/* Intelligence */}
                <Route path="ad-intelligence" element={<AdIntelligencePage />} />
                <Route path="meta-ads" element={<MetaAdsPage />} />
                <Route path="competitors" element={<CompetitorsPage />} />
                <Route path="discoveries" element={<DiscoveriesPage />} />
                <Route path="gpf2-ops" element={<Gpf2OpsPage />} />
                <Route path="gpc/pipeline" element={<GpcPipelinePage />} />

                {/* Operations */}
                <Route path="integrations" element={<IntegrationsPage />} />
                <Route path="data-inventory" element={<DataInventoryPage />} />

                {/* Learning */}
                <Route path="learning" element={<LearningPage />} />

                {/* Brand Launchpad — admin */}
                <Route path="admin/launchpad" element={<LaunchpadAdminPage />} />

                {/* System */}
                <Route path="reports" element={<ReportsPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="guide" element={<GuidePage />} />
              </Route>
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </div>
    </CompanyContext.Provider>
  )
}
