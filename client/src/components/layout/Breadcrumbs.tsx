import { Link, useLocation } from "react-router-dom"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"

const routeLabels: Record<string, string> = {
  "": "Dashboard",
  contacts: "Contacts",
  campaigns: "Campaigns",
  outbound: "Outbound Hub",
  writer: "Campaign Writer",
  enrichment: "Enrichment",
  pipelines: "Pipelines",
  agents: "Agents",
  tasks: "Tasks",
  openclaw: "OpenClaw",
  analytics: "Analytics",
  settings: "Settings",
  "meta-ads": "Meta Ads",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  discoveries: "AI Discoveries",
  competitors: "Competitors",
  scraping: "Scraping",
  btr: "BTR Conference",
}

export function Breadcrumbs() {
  const location = useLocation()
  const segments = location.pathname.split("/").filter(Boolean)

  if (segments.length === 0) {
    return (
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbPage>Dashboard</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    )
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink render={<Link to="/" />}>Dashboard</BreadcrumbLink>
        </BreadcrumbItem>
        {segments.map((segment, index) => {
          const path = "/" + segments.slice(0, index + 1).join("/")
          const isLast = index === segments.length - 1
          const label = routeLabels[segment] ?? decodeURIComponent(segment)

          return (
            <span key={path} className="contents">
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink render={<Link to={path} />}>{label}</BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </span>
          )
        })}
      </BreadcrumbList>
    </Breadcrumb>
  )
}
