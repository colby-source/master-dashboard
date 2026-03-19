import { useCompany } from "@/contexts/CompanyContext"
import { ExecutiveSummary } from "@/components/layout/ExecutiveSummary"
import { CompanyScorecard } from "@/components/panels/CompanyScorecard"
import { ChartsPanel } from "@/components/panels/ChartsPanel"
import { AlertsFeed } from "@/components/panels/AlertsFeed"
import { EventsTimeline } from "@/components/panels/EventsTimeline"
import { DashboardChat } from "@/components/panels/DashboardChat"
import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function DashboardPage() {
  const { companyId } = useCompany()

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <a href="/api/exports/executive-summary.docx" download>
          <Button variant="outline" size="sm" className="gap-2">
            <Download className="h-4 w-4" />
            Export Summary
          </Button>
        </a>
      </div>
      <ExecutiveSummary companyId={companyId} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CompanyScorecard companyId={companyId} />
        <DashboardChat />
        <div className="lg:col-span-2">
          <ChartsPanel />
        </div>
        <AlertsFeed companyId={companyId} />
        <EventsTimeline />
      </div>
    </div>
  )
}
