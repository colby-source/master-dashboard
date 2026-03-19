import { useCompany } from "@/contexts/CompanyContext"
import { CampaignsPanel } from "@/components/panels/CampaignsPanel"

export default function CampaignsPage() {
  const { companyId } = useCompany()

  return <CampaignsPanel companyId={companyId} />
}
