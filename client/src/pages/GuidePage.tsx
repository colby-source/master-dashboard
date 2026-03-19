import { useState } from "react"
import { Link } from "react-router-dom"
import {
  LayoutDashboard,
  Users,
  Mail,
  Send,
  PenTool,
  Sparkles,
  GitBranch,
  Megaphone,
  Globe,
  Instagram,
  MessageSquare,
  Bot,
  ListTodo,
  Radar,
  Search,
  Target,
  Presentation,
  BarChart3,
  Settings,
  MessageCircle,
  ChevronRight,
  ArrowRight,
  Download,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

interface GuideSection {
  id: string
  title: string
  icon: React.ElementType
  path: string
  description: string
  steps: { title: string; detail: string }[]
  aiCommands: string[]
}

const guideSections: GuideSection[] = [
  {
    id: "dashboard",
    title: "Dashboard",
    icon: LayoutDashboard,
    path: "/",
    description:
      "Your command center. See active campaigns, open tasks, agent health, alerts, and events at a glance.",
    steps: [
      {
        title: "View Executive Summary",
        detail:
          "The top row shows 5 cards: Active Campaigns, Open Tasks, Agent Health %, Due Today, and Alerts. These auto-refresh every 60 seconds.",
      },
      {
        title: "Company Scorecard",
        detail:
          "Shows per-company breakdown of campaigns, contacts enriched, and pipeline value. Use the company selector in the sidebar to filter.",
      },
      {
        title: "Charts & Analytics",
        detail:
          "Visual charts for campaign performance over time. Hover over data points for exact values.",
      },
      {
        title: "Alerts Feed",
        detail:
          "Real-time alerts for bounced emails, failed agents, and anomalies. Click 'Acknowledge' to dismiss.",
      },
      {
        title: "Events Timeline",
        detail:
          "Live feed of everything happening: enrichments, emails sent, replies received, agent runs, and more.",
      },
      {
        title: "Dashboard AI Chat",
        detail:
          'Ask questions about your data directly. Try: "What\'s my best performing campaign?" or "How many leads were enriched today?"',
      },
    ],
    aiCommands: [
      "Show me the dashboard summary",
      "What are my active alerts?",
      "How many campaigns are active?",
    ],
  },
  {
    id: "campaigns",
    title: "Campaigns",
    icon: Mail,
    path: "/campaigns",
    description:
      "Manage cold email campaigns synced from Instantly. View performance, drill into sequences, and monitor delivery.",
    steps: [
      {
        title: "View All Campaigns",
        detail:
          "Navigate to Campaigns to see a list of all campaigns with open rate, reply rate, sent count, and status. Click any campaign to drill down.",
      },
      {
        title: "Campaign Detail View",
        detail:
          "Click a campaign to see its full sequence: each email step with send/open/reply counts, timing delays, and contact list.",
      },
      {
        title: "Pause/Resume Campaign",
        detail:
          'Use the status toggle or the AI assistant: "Pause campaign Q1 Outreach".',
      },
      {
        title: "Monitor Delivery",
        detail:
          "Check bounce rates and delivery status. High bounce rates trigger automatic alerts.",
      },
      {
        title: "AI Campaign Variations",
        detail:
          "Go to Campaign Writer to let AI analyze your best campaign and generate 3 new variations with subject lines and body copy.",
      },
    ],
    aiCommands: [
      "Show me all campaigns",
      "What's the open rate for campaign Q1 Outreach?",
      "Pause campaign [name]",
      "Activate campaign [name]",
    ],
  },
  {
    id: "outbound",
    title: "Outbound Hub",
    icon: Send,
    path: "/outbound",
    description:
      "Central hub for outbound operations. Manage sending schedules, warm-up accounts, and delivery health.",
    steps: [
      {
        title: "Check Sending Status",
        detail:
          "View active sending accounts, daily limits, and warm-up progress for your Instantly accounts.",
      },
      {
        title: "Monitor Deliverability",
        detail:
          "Track inbox placement rates and spam scores across your sending domains.",
      },
    ],
    aiCommands: ["Show outbound status"],
  },
  {
    id: "writer",
    title: "Campaign Writer",
    icon: PenTool,
    path: "/writer",
    description:
      "AI-powered email copy generator. Analyzes your top campaigns and creates variations optimized for higher engagement.",
    steps: [
      {
        title: "Select a Campaign",
        detail:
          "Choose a high-performing campaign to use as the foundation for AI variations.",
      },
      {
        title: "Generate Variations",
        detail:
          'Click "Generate" and Claude AI will analyze your campaign performance and create 3 new email variations with subject lines, body copy, and reasoning.',
      },
      {
        title: "Review & Use",
        detail:
          "Review each variation's reasoning, then copy the subject and body into Instantly to create new campaign sequences.",
      },
    ],
    aiCommands: ["Generate variations for campaign [name]"],
  },
  {
    id: "contacts",
    title: "Contacts",
    icon: Users,
    path: "/contacts",
    description:
      "Full CRM contact database. Search, filter, sort, and drill into any contact to see their complete profile, enrichment data, email history, and AI scoring.",
    steps: [
      {
        title: "Browse Contacts",
        detail:
          "Sortable data table with columns: Name, Email, Company, Score, Source, Status, Cold Email Status, Last Activity. Click column headers to sort.",
      },
      {
        title: "Search & Filter",
        detail:
          "Use the search box for name/email/company. Filter by status, score label (Hot/Warm/Cold), source, or company.",
      },
      {
        title: "Contact Detail Page",
        detail:
          "Click any contact to see their full profile: contact info, enrichment data (PDL), AI score with reasoning, email conversations, activity timeline, and campaign associations.",
      },
      {
        title: "Enrich a Contact",
        detail:
          'On the contact detail page, click "Re-Enrich" to pull fresh data from People Data Labs and update the score.',
      },
      {
        title: "Approve for Cold Email",
        detail:
          'Click "Approve" to push an enriched contact to Instantly for cold email outreach. The system generates personalized variables using AI.',
      },
      {
        title: "Exclude from Outreach",
        detail:
          'Click "Exclude" to permanently block a contact from cold email campaigns with a reason.',
      },
    ],
    aiCommands: [
      'Search contacts named "John"',
      "Show me hot leads",
      "Get details for contact [email]",
      "Enrich contact [email]",
      "Approve contact [email] for cold email",
      "Exclude contact [email]",
    ],
  },
  {
    id: "enrichment",
    title: "Enrichment",
    icon: Sparkles,
    path: "/enrichment",
    description:
      "Lead enrichment pipeline powered by People Data Labs and Hunter.io. Automatically enriches, scores, and qualifies new leads.",
    steps: [
      {
        title: "View Enrichment Queue",
        detail:
          "See leads pending enrichment, currently processing, and recently completed with their scores.",
      },
      {
        title: "Trigger Manual Enrichment",
        detail:
          'Select a lead and click "Enrich" to pull data from PDL (job title, company, industry, revenue, etc.) and verify the email with Hunter.',
      },
      {
        title: "Review AI Scoring",
        detail:
          "After enrichment, Claude AI scores each lead 0-100 based on your company's ICP. View the score, label (Hot/Warm/Cold/Disqualified), reasoning, tags, and personalization data.",
      },
      {
        title: "Configure Scoring Rules",
        detail:
          "In Settings, customize the scoring prompt, ICP criteria, and threshold levels for each company.",
      },
      {
        title: "Auto-Processing Pipeline",
        detail:
          "When auto_approve is enabled, leads scoring above the threshold are automatically pushed to GHL and Instantly.",
      },
    ],
    aiCommands: [
      "Show enrichment stats",
      "Enrich contact [email]",
      "Score contact [email]",
      "Process lead [email] through the full pipeline",
    ],
  },
  {
    id: "pipelines",
    title: "Pipelines",
    icon: GitBranch,
    path: "/pipelines",
    description:
      "GoHighLevel CRM pipeline management. Track deal stages, move contacts between stages, and monitor conversion.",
    steps: [
      {
        title: "View Pipeline Stages",
        detail:
          "See all pipeline stages with contact counts. Stages represent the sales journey from lead to closed.",
      },
      {
        title: "Push Contacts to GHL",
        detail:
          'Enriched contacts can be pushed to GoHighLevel with tags, custom fields, and pipeline stage assignments. Use "Push to GHL" on any contact.',
      },
    ],
    aiCommands: [
      "Push contact [email] to GHL",
    ],
  },
  {
    id: "meta-ads",
    title: "Meta Ads",
    icon: Megaphone,
    path: "/meta-ads",
    description:
      "Monitor and manage Meta (Facebook/Instagram) advertising campaigns. View spend, ROAS, CPL, and performance breakdowns.",
    steps: [
      {
        title: "Connect Account",
        detail:
          "Set META_ACCESS_TOKEN and META_AD_ACCOUNT_ID in your .env file to connect your Meta Business account.",
      },
      {
        title: "View Ad Performance",
        detail:
          "See campaign-level metrics: impressions, clicks, CTR, spend, CPC, and conversions.",
      },
      {
        title: "Breakdown Analysis",
        detail:
          "Analyze performance by age, gender, region, or platform placement to optimize targeting.",
      },
    ],
    aiCommands: [],
  },
  {
    id: "linkedin",
    title: "LinkedIn",
    icon: Globe,
    path: "/linkedin",
    description:
      "LinkedIn automation and outreach management. Track connection requests, messages, and profile views.",
    steps: [
      {
        title: "View LinkedIn Activity",
        detail:
          "Monitor outbound connection requests, messages sent, and response rates.",
      },
    ],
    aiCommands: [],
  },
  {
    id: "instagram",
    title: "Instagram",
    icon: Instagram,
    path: "/instagram",
    description:
      "Instagram DM campaigns and automation. Send targeted DMs based on follower lists and engagement data.",
    steps: [
      {
        title: "Create DM Campaign",
        detail:
          "Set up an Instagram DM campaign with target audience, message templates, and sending schedule.",
      },
      {
        title: "Monitor Delivery",
        detail:
          "Track DM send rates, response rates, and conversation outcomes.",
      },
    ],
    aiCommands: [],
  },
  {
    id: "whatsapp",
    title: "WhatsApp",
    icon: MessageSquare,
    path: "/whatsapp",
    description:
      "WhatsApp Business messaging integration. Send templates, manage conversations, and track message delivery.",
    steps: [
      {
        title: "Send Messages",
        detail:
          "Use WhatsApp Business API templates to send approved messages to contacts.",
      },
      {
        title: "Manage Conversations",
        detail:
          "View and respond to incoming WhatsApp messages. Track delivery and read receipts.",
      },
    ],
    aiCommands: [],
  },
  {
    id: "discoveries",
    title: "AI Discoveries",
    icon: Sparkles,
    path: "/discoveries",
    description:
      "AI-generated insights and recommendations based on your data patterns. Automatically surfaces opportunities and risks.",
    steps: [
      {
        title: "Review Discoveries",
        detail:
          "AI analyzes your campaign data, contact engagement, and agent performance to surface actionable insights.",
      },
      {
        title: "Save or Dismiss",
        detail:
          'Click "Save" to keep important discoveries for reference, or "Dismiss" to clear them.',
      },
    ],
    aiCommands: [],
  },
  {
    id: "competitors",
    title: "Competitors",
    icon: Radar,
    path: "/competitors",
    description:
      "Monitor competitor websites and social media for changes. Track pricing, messaging, and product updates.",
    steps: [
      {
        title: "Add a Competitor",
        detail:
          "Enter a competitor's website URL and social links. The system will periodically scrape and compare changes.",
      },
      {
        title: "View Changes",
        detail:
          "See a timeline of detected changes: new pages, pricing updates, messaging shifts, and social activity.",
      },
    ],
    aiCommands: ["Show competitor updates"],
  },
  {
    id: "scraping",
    title: "Scraping",
    icon: Search,
    path: "/scraping",
    description:
      "Web scraping powered by Apify. Extract contact data, company information, and lead lists from websites and social platforms.",
    steps: [
      {
        title: "Run a Scraping Job",
        detail:
          "Configure an Apify actor with target URLs and extraction parameters. Start the job and monitor progress.",
      },
      {
        title: "Import Results",
        detail:
          "Scraped contacts are imported into the enrichment pipeline for automatic processing.",
      },
    ],
    aiCommands: [],
  },
  {
    id: "agents",
    title: "Agents",
    icon: Bot,
    path: "/agents",
    description:
      "Automated background workers that run on schedules. Sync campaigns, process leads, monitor competitors, and more.",
    steps: [
      {
        title: "View Agent Status",
        detail:
          "See all agents with their status (active/paused/error), type, success rate, and last run time.",
      },
      {
        title: "Check Agent History",
        detail:
          "Click an agent to see its run history with timestamps, durations, and error logs.",
      },
      {
        title: "Create New Agent",
        detail:
          "Define a new agent with a name, type, schedule (cron expression), and configuration.",
      },
    ],
    aiCommands: [
      "Show all agents",
      "What agents are running?",
    ],
  },
  {
    id: "tasks",
    title: "Tasks",
    icon: ListTodo,
    path: "/tasks",
    description:
      "Task management for your team. Create, assign, prioritize, and track tasks across all operations.",
    steps: [
      {
        title: "View Tasks",
        detail:
          "See all tasks organized by status: To Do, In Progress, Done. Filter by priority (High/Medium/Low).",
      },
      {
        title: "Create a Task",
        detail:
          'Click "New Task" or tell the AI: "Create a task to follow up with John about the fund deck". Set title, priority, and description.',
      },
      {
        title: "Complete a Task",
        detail:
          'Mark tasks as done when finished. Or tell the AI: "Complete task #5".',
      },
    ],
    aiCommands: [
      "Show open tasks",
      "Create a task: [title]",
      "Complete task #[id]",
    ],
  },
  {
    id: "openclaw",
    title: "OpenClaw",
    icon: Target,
    path: "/openclaw",
    description:
      "Deal tracking and opportunity management. Monitor active deals, stages, and revenue pipeline.",
    steps: [
      {
        title: "View Deals",
        detail:
          "See all deals with their stage, value, probability, and expected close date.",
      },
      {
        title: "Update Deal Stage",
        detail:
          "Move deals through pipeline stages as they progress from prospect to closed-won.",
      },
    ],
    aiCommands: [],
  },
  {
    id: "btr",
    title: "BTR Conference",
    icon: Presentation,
    path: "/btr",
    description:
      "Conference and event management. Track attendees, schedule sessions, and manage event logistics.",
    steps: [
      {
        title: "Manage Conference",
        detail:
          "View conference details, attendee lists, session schedules, and event status.",
      },
    ],
    aiCommands: [],
  },
  {
    id: "analytics",
    title: "Analytics",
    icon: BarChart3,
    path: "/analytics",
    description:
      "Full-width analytics and reporting. Visual charts for campaign performance, contact growth, and agent metrics.",
    steps: [
      {
        title: "View Charts",
        detail:
          "Interactive charts showing campaign performance over time, contact acquisition trends, and agent run metrics.",
      },
    ],
    aiCommands: [],
  },
  {
    id: "settings",
    title: "Settings",
    icon: Settings,
    path: "/settings",
    description:
      "Configure enrichment rules, AI scoring prompts, company playbooks, and integration credentials.",
    steps: [
      {
        title: "Enrichment Config",
        detail:
          "Set auto-enrich rules, scoring thresholds (Hot/Warm/Cold), and default company ICP prompts.",
      },
      {
        title: "Company Playbooks",
        detail:
          "Configure AI auto-reply playbooks per company: tone, value props, objection handlers, escalation triggers, booking URL.",
      },
      {
        title: "Integration Keys",
        detail:
          "Manage API keys for Instantly, GHL, Meta, PDL, Hunter, Apify, and other integrations in your .env file.",
      },
    ],
    aiCommands: [],
  },
  {
    id: "ai-assistant",
    title: "AI Assistant",
    icon: MessageCircle,
    path: "/ai-assistant",
    description:
      "Chat with AI to control the entire dashboard using natural language. Search contacts, create tasks, manage campaigns, and more — just by typing.",
    steps: [
      {
        title: "Open AI Assistant",
        detail:
          'Navigate to the AI Assistant page from the sidebar. You\'ll see a chat interface.',
      },
      {
        title: "Type a Command",
        detail:
          'Type what you want in plain English. Examples: "Show me all hot leads", "Create a task to call John", "Pause campaign Q1 Outreach".',
      },
      {
        title: "Review Actions",
        detail:
          "The AI will show you what actions it took (searched contacts, created task, etc.) along with the results.",
      },
      {
        title: "Navigation Commands",
        detail:
          'Say "Go to contacts" or "Open the campaigns page" and the AI will navigate the dashboard for you.',
      },
    ],
    aiCommands: [
      "Show me all hot leads",
      "Create a task to follow up with John",
      "What's my best campaign?",
      "Enrich all new leads",
      "Show open tasks",
      "Go to contacts page",
    ],
  },
]

export default function GuidePage() {
  const [expandedSection, setExpandedSection] = useState<string | null>(null)

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">How to Use This Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Step-by-step guide for every feature. Click any section to expand.
          </p>
        </div>
        <a href="/api/exports/guide.docx" download>
          <Button variant="outline" size="sm" className="gap-2">
            <Download className="h-4 w-4" />
            Download Guide
          </Button>
        </a>
      </div>

      {/* Quick start */}
      <div className="rounded-lg border border-border bg-card p-5">
        <h2 className="text-lg font-semibold mb-3">Quick Start</h2>
        <ol className="space-y-2 text-sm">
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
              1
            </span>
            <span>
              <strong>Select a company</strong> from the sidebar dropdown (or
              "All Companies" for a global view).
            </span>
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
              2
            </span>
            <span>
              <strong>Check the Dashboard</strong> for alerts, active campaigns,
              and tasks due today.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
              3
            </span>
            <span>
              <strong>Review Contacts</strong> — browse enriched leads, check
              AI scores, and approve hot leads for outreach.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
              4
            </span>
            <span>
              <strong>Use the AI Assistant</strong> — type natural language
              commands to control everything without clicking through menus.
            </span>
          </li>
        </ol>
      </div>

      {/* Sections */}
      <div className="space-y-2">
        {guideSections.map((section) => {
          const isExpanded = expandedSection === section.id
          const Icon = section.icon

          return (
            <div
              key={section.id}
              className="rounded-lg border border-border bg-card overflow-hidden"
            >
              {/* Header */}
              <button
                onClick={() =>
                  setExpandedSection(isExpanded ? null : section.id)
                }
                className="w-full flex items-center gap-3 p-4 text-left hover:bg-accent/50 transition-colors"
              >
                <Icon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{section.title}</div>
                  <div className="text-sm text-muted-foreground truncate">
                    {section.description}
                  </div>
                </div>
                <Link
                  to={section.path}
                  onClick={(e) => e.stopPropagation()}
                  className="text-xs text-primary hover:underline flex-shrink-0 mr-2"
                >
                  Open
                </Link>
                <ChevronRight
                  className={`h-4 w-4 text-muted-foreground transition-transform ${
                    isExpanded ? "rotate-90" : ""
                  }`}
                />
              </button>

              {/* Expanded content */}
              {isExpanded && (
                <div className="border-t border-border px-4 pb-4">
                  {/* Steps */}
                  <div className="mt-4 space-y-3">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                      Step by Step
                    </h3>
                    {section.steps.map((step, i) => (
                      <div key={i} className="flex gap-3">
                        <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                          {i + 1}
                        </div>
                        <div>
                          <div className="font-medium text-sm">
                            {step.title}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {step.detail}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* AI Commands */}
                  {section.aiCommands.length > 0 && (
                    <div className="mt-4">
                      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                        AI Commands
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {section.aiCommands.map((cmd, i) => (
                          <Link key={i} to="/ai-assistant">
                            <Badge
                              variant="secondary"
                              className="cursor-pointer hover:bg-accent"
                            >
                              <MessageCircle className="h-3 w-3 mr-1" />
                              {cmd}
                            </Badge>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Go to page link */}
                  <div className="mt-4 pt-3 border-t border-border">
                    <Link
                      to={section.path}
                      className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                    >
                      Go to {section.title}
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
