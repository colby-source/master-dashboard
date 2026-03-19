import { useCompany } from "@/contexts/CompanyContext"
import { GhlPipelinesPanel } from "@/components/panels/GhlPipelinesPanel"

export default function PipelinesPage() {
  const { companyId } = useCompany()

  return <GhlPipelinesPanel companyId={companyId} />
}
