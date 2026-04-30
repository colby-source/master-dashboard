import { useCompany } from "@/contexts/CompanyContext"
import { CampaignWriter } from "@/components/panels/CampaignWriter"

export default function CampaignWriterPage() {
  const { companyId } = useCompany()

  return <CampaignWriter companyId={companyId} />
}
