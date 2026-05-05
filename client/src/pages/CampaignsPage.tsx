import { useState } from "react"
import { useCompany } from "@/contexts/CompanyContext"
import { CampaignsPanel } from "@/components/panels/CampaignsPanel"
import { CampaignWriter } from "@/components/panels/CampaignWriter"
import { AbTestingPanel } from "@/components/panels/AbTestingPanel"
import { Mail, PenTool, FlaskConical } from "lucide-react"

type TabId = "campaigns" | "writer" | "ab-testing"

const tabs: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "campaigns", label: "Campaigns", icon: Mail },
  { id: "writer", label: "Writer", icon: PenTool },
  { id: "ab-testing", label: "A/B Testing", icon: FlaskConical },
]

export default function CampaignsPage() {
  const { companyId } = useCompany()
  const [activeTab, setActiveTab] = useState<TabId>("campaigns")

  return (
    <div className="flex flex-col h-full">
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-1 px-4 py-2">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <tab.icon className="size-4" />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {activeTab === "campaigns" && <CampaignsPanel companyId={companyId} />}
        {activeTab === "writer" && <CampaignWriter companyId={companyId} />}
        {activeTab === "ab-testing" && <AbTestingPanel />}
      </div>
    </div>
  )
}
