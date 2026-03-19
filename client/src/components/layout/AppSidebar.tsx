import { Link, useLocation } from "react-router-dom"
import {
  LayoutDashboard,
  Users,
  Mail,
  Send,
  Sparkles,
  Target,
  GitBranch,
  Bot,
  ListTodo,
  BarChart3,
  Settings,
  Megaphone,
  PenTool,
  Globe,
  Instagram,
  MessageSquare,
  Radar,
  Search,
  Presentation,
  Zap,
  ChevronDown,
  BookOpen,
  MessageCircle,
  ShieldCheck,
  Eye,
  SearchCheck,
  FlaskConical,
  FileText,
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

const navGroups = [
  {
    label: "Overview",
    items: [
      { title: "Dashboard", icon: LayoutDashboard, path: "/" },
      { title: "AI Assistant", icon: MessageCircle, path: "/ai-assistant" },
      { title: "Analytics", icon: BarChart3, path: "/analytics" },
    ],
  },
  {
    label: "Outreach",
    items: [
      { title: "Campaigns", icon: Mail, path: "/campaigns" },
      { title: "Outbound Hub", icon: Send, path: "/outbound" },
      { title: "Campaign Writer", icon: PenTool, path: "/writer" },
      { title: "Domain Health", icon: ShieldCheck, path: "/domain-health" },
      { title: "A/B Testing", icon: FlaskConical, path: "/ab-testing" },
    ],
  },
  {
    label: "CRM",
    items: [
      { title: "Contacts", icon: Users, path: "/contacts" },
      { title: "Pipelines", icon: GitBranch, path: "/pipelines" },
      { title: "Enrichment", icon: Sparkles, path: "/enrichment" },
      { title: "GHL Command", icon: Zap, path: "/ghl" },
      { title: "Lookup", icon: SearchCheck, path: "/lookup" },
      { title: "Transcripts", icon: FileText, path: "/meeting-transcripts" },
    ],
  },
  {
    label: "Channels",
    items: [
      { title: "Meta Ads", icon: Megaphone, path: "/meta-ads" },
      { title: "LinkedIn", icon: Globe, path: "/linkedin" },
      { title: "Instagram", icon: Instagram, path: "/instagram" },
      { title: "WhatsApp", icon: MessageSquare, path: "/whatsapp" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { title: "AI Discoveries", icon: Sparkles, path: "/discoveries" },
      { title: "RB2B Visitors", icon: Eye, path: "/rb2b" },
      { title: "Competitors", icon: Radar, path: "/competitors" },
      { title: "Scraping", icon: Search, path: "/scraping" },
    ],
  },
  {
    label: "Operations",
    items: [
      { title: "Agents", icon: Bot, path: "/agents" },
      { title: "Tasks", icon: ListTodo, path: "/tasks" },
      { title: "OpenClaw", icon: Target, path: "/openclaw" },
      { title: "BTR Conference", icon: Presentation, path: "/btr" },
    ],
  },
]

export function AppSidebar({ companyId, onCompanyChange, companies }: AppSidebarProps) {
  const location = useLocation()

  const selectedCompany = companies.find((c) => c.id === companyId)

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
                {companies.map((company) => (
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
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
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
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
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
