import { useCompany } from "@/contexts/CompanyContext"
import { AgentsPanel } from "@/components/panels/AgentsPanel"

export default function AgentsPage() {
  const { companyId } = useCompany()

  return <AgentsPanel companyId={companyId} />
}
