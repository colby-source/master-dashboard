import { Outlet } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { useQuery } from "@tanstack/react-query"
import { RefreshCw, Bell, Search } from "lucide-react"

import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { AppSidebar } from "@/components/layout/AppSidebar"
import { Breadcrumbs } from "@/components/layout/Breadcrumbs"
import { api } from "@/lib/api"

interface AppShellProps {
  companyId: number | undefined
  onCompanyChange: (id: number | undefined) => void
  companies: any[]
}

export function AppShell({ companyId, onCompanyChange, companies }: AppShellProps) {
  const queryClient = useQueryClient()
  const { data: alerts = [] } = useQuery({
    queryKey: ["alerts"],
    queryFn: api.getAlerts,
    refetchInterval: 60000,
  })

  return (
    <SidebarProvider>
      <AppSidebar
        companyId={companyId}
        onCompanyChange={onCompanyChange}
        companies={companies}
      />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
          <Breadcrumbs />
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() =>
                document.dispatchEvent(
                  new KeyboardEvent("keydown", { key: "k", ctrlKey: true })
                )
              }
              className="text-muted-foreground"
            >
              <Search className="size-4" />
              <span className="sr-only">Search</span>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => queryClient.invalidateQueries()}
              className="text-muted-foreground"
            >
              <RefreshCw className="size-4" />
              <span className="sr-only">Refresh</span>
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="relative text-muted-foreground"
            >
              <Bell className="size-4" />
              {alerts.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] text-white">
                  {alerts.length}
                </span>
              )}
              <span className="sr-only">Notifications</span>
            </Button>
          </div>
        </header>
        <main className="flex-1 overflow-auto p-4">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
