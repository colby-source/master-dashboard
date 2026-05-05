import { useState } from "react"
import { Link, useLocation } from "react-router-dom"
import {
  Activity,
  Workflow,
  Users,
  Send,
  Sparkles,
  Target,
  GitBranch,
  BarChart3,
  Settings,
  Megaphone,
  Radar,
  Zap,
  ChevronDown,
  ChevronRight,
  BookOpen,
  MessageCircle,
  ShieldCheck,
  FileText,
  MailCheck,
  Database,
  Brain,
  Plug,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface Company {
  id: number
  name: string
  color: string
}

interface AppSidebarProps {
  companyId: number | undefined
  onCompanyChange: (id: number | undefined) => void
  companies: Company[]
}

interface NavItem {
  title: string
  icon: React.ElementType
  path: string
}

interface NavGroup {
  label: string
  icon: React.ElementType
  items: NavItem[]
}

const navGroups: NavGroup[] = [
  {
    label: "Engine",
    icon: Activity,
    items: [
      { title: "Pipeline", icon: Workflow, path: "/" },
      { title: "Campaigns", icon: Send, path: "/campaigns" },
      { title: "Reply Review", icon: MailCheck, path: "/reply-review" },
      { title: "Domain Health", icon: ShieldCheck, path: "/domain-health" },
    ],
  },
  {
    label: "Data",
    icon: Database,
    items: [
      { title: "Inventory", icon: Database, path: "/data-inventory" },
      { title: "Contacts", icon: Users, path: "/contacts" },
      { title: "Enrichment", icon: Sparkles, path: "/enrichment" },
      { title: "Pipelines (CRM)", icon: GitBranch, path: "/pipelines" },
    ],
  },
  {
    label: "Intelligence",
    icon: Target,
    items: [
      { title: "Ad Intel", icon: Megaphone, path: "/ad-intelligence" },
      { title: "Meta Ads", icon: Megaphone, path: "/meta-ads" },
      { title: "Competitors", icon: Radar, path: "/competitors" },
      { title: "AI Discoveries", icon: Sparkles, path: "/discoveries" },
    ],
  },
  {
    label: "Learning",
    icon: Brain,
    items: [
      { title: "Recommendations", icon: Sparkles, path: "/learning" },
      { title: "Analytics", icon: BarChart3, path: "/analytics" },
      { title: "AI Assistant", icon: MessageCircle, path: "/ai-assistant" },
    ],
  },
  {
    label: "Operations",
    icon: Settings,
    items: [
      { title: "GPF-II Ops", icon: Target, path: "/gpf2-ops" },
      { title: "GPC Pipeline", icon: Database, path: "/gpc/pipeline" },
      { title: "GHL Command", icon: Zap, path: "/ghl" },
      { title: "Integrations", icon: Plug, path: "/integrations" },
    ],
  },
]

// Only allow GPC and BMN in the company switcher. Filters by name match
// (case-insensitive contains "granite", "gpc", "bmn", or "brand me now").
const ALLOWED_COMPANY_PATTERNS = [/granite/i, /\bgpc\b/i, /\bbmn\b/i, /brand\s*me\s*now/i]

function isAllowedCompany(name: string | undefined): boolean {
  if (!name) return false
  return ALLOWED_COMPANY_PATTERNS.some((re) => re.test(name))
}

function CollapsibleNavGroup({ group }: { group: NavGroup }) {
  const location = useLocation()
  const isGroupActive = group.items.some(item =>
    item.path === "/"
      ? location.pathname === "/"
      : location.pathname.startsWith(item.path)
  )
  const [isOpen, setIsOpen] = useState(isGroupActive)

  return (
    <SidebarGroup>
      <SidebarGroupLabel
        className="cursor-pointer select-none flex items-center justify-between hover:text-foreground transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="flex items-center gap-2">
          <group.icon className="size-3.5" />
          {group.label}
        </span>
        {isOpen
          ? <ChevronDown className="size-3.5 opacity-50" />
          : <ChevronRight className="size-3.5 opacity-50" />
        }
      </SidebarGroupLabel>
      {isOpen && (
        <SidebarGroupContent>
          <SidebarMenu>
            {group.items.map((item) => {
              const isActive =
                item.path === "/"
                  ? location.pathname === "/"
                  : location.pathname.startsWith(item.path)
              return (
                <SidebarMenuItem key={item.path}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    isActive={isActive}
                    render={<Link to={item.path} />}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      )}
    </SidebarGroup>
  )
}

export function AppSidebar({ companyId, onCompanyChange, companies }: AppSidebarProps) {
  const location = useLocation()
  // Filter to only GPC + BMN at the consumer level, leaving the underlying
  // hook untouched (other pages still see the full list).
  const visibleCompanies = companies.filter((c) => isAllowedCompany(c.name))
  const selectedCompany = visibleCompanies.find((c) => c.id === companyId)

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                />}
              >
                  <div
                    className="flex aspect-square size-8 items-center justify-center rounded-lg text-white text-xs font-bold"
                    style={{
                      backgroundColor: selectedCompany?.color ?? "#6366f1",
                    }}
                  >
                    {selectedCompany
                      ? selectedCompany.name.charAt(0)
                      : "All"}
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">
                      {selectedCompany?.name ?? "All Companies"}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      Command Center
                    </span>
                  </div>
                  <ChevronDown className="ml-auto" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                align="start"
                sideOffset={4}
              >
                <DropdownMenuItem onClick={() => onCompanyChange(undefined)}>
                  <div className="flex items-center gap-2">
                    <div className="flex size-6 items-center justify-center rounded-md bg-muted text-xs font-bold">
                      All
                    </div>
                    <span>All Companies</span>
                  </div>
                </DropdownMenuItem>
                {visibleCompanies.map((company) => (
                  <DropdownMenuItem
                    key={company.id}
                    onClick={() => onCompanyChange(company.id)}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="flex size-6 items-center justify-center rounded-md text-white text-xs font-bold"
                        style={{ backgroundColor: company.color }}
                      >
                        {company.name.charAt(0)}
                      </div>
                      <span>{company.name}</span>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        {navGroups.map((group) => (
          <CollapsibleNavGroup key={group.label} group={group} />
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Reports"
              isActive={location.pathname.startsWith("/reports")}
              render={<Link to="/reports" />}
            >
              <FileText />
              <span>Reports</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Guide"
              isActive={location.pathname.startsWith("/guide")}
              render={<Link to="/guide" />}
            >
              <BookOpen />
              <span>Guide</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Settings"
              isActive={location.pathname.startsWith("/settings")}
              render={<Link to="/settings" />}
            >
              <Settings />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
