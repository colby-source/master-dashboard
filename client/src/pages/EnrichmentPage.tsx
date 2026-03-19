import { useCompany } from "@/contexts/CompanyContext"
import { EnrichmentPanel } from "@/components/panels/EnrichmentPanel"

export default function EnrichmentPage() {
  const { companyId } = useCompany()

  return <EnrichmentPanel companyId={companyId} />
}
