import { useCompany } from "@/contexts/CompanyContext"
import { TasksPanel } from "@/components/panels/TasksPanel"

export default function TasksPage() {
  const { companyId } = useCompany()

  return <TasksPanel companyId={companyId} />
}
