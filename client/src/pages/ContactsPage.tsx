import * as React from "react"
import { useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { type ColumnDef } from "@tanstack/react-table"
import { useCompany } from "@/contexts/CompanyContext"
import { api } from "@/lib/api"
import { DataTable, SortableHeader } from "@/components/shared/DataTable"
import { StatusBadge, ScoreBadge } from "@/components/shared/StatusBadge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"
import { UserPlus } from "lucide-react"
import { formatDistanceToNow } from "date-fns"

interface Lead {
  id: number
  first_name: string | null
  last_name: string | null
  email: string
  phone: string | null
  company_id: number
  source: string | null
  status: string
  score: number | null
  score_label: string | null
  instantly_push_status: string | null
  enrichment_data: string | null
  created_at: string
  updated_at: string
}

function getCompanyName(lead: Lead): string {
  if (!lead.enrichment_data) return "—"
  try {
    const data = JSON.parse(lead.enrichment_data)
    return data?.pdl_person?.job_company_name ?? data?.pdl_company?.name ?? "—"
  } catch {
    return "—"
  }
}

const columns: ColumnDef<Lead, any>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => <SortableHeader column={column}>Name</SortableHeader>,
    accessorFn: (row) =>
      [row.first_name, row.last_name].filter(Boolean).join(" ") || row.email,
    cell: ({ row }) => {
      const name = [row.original.first_name, row.original.last_name]
        .filter(Boolean)
        .join(" ")
      return (
        <span className="font-medium text-foreground">
          {name || row.original.email}
        </span>
      )
    },
  },
  {
    accessorKey: "email",
    header: ({ column }) => <SortableHeader column={column}>Email</SortableHeader>,
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.email}</span>
    ),
  },
  {
    id: "company",
    header: "Company",
    accessorFn: getCompanyName,
    cell: ({ getValue }) => (
      <span className="text-muted-foreground">{getValue() as string}</span>
    ),
  },
  {
    accessorKey: "score",
    header: ({ column }) => <SortableHeader column={column}>Score</SortableHeader>,
    cell: ({ row }) => (
      <ScoreBadge score={row.original.score} label={row.original.score_label} />
    ),
  },
  {
    accessorKey: "source",
    header: "Source",
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">
        {row.original.source?.replace(/_/g, " ") ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge type="status" value={row.original.status} />,
  },
  {
    accessorKey: "instantly_push_status",
    header: "Cold Email",
    cell: ({ row }) => (
      <StatusBadge type="push" value={row.original.instantly_push_status} />
    ),
  },
  {
    accessorKey: "updated_at",
    header: ({ column }) => (
      <SortableHeader column={column}>Last Activity</SortableHeader>
    ),
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground">
        {row.original.updated_at
          ? formatDistanceToNow(new Date(row.original.updated_at), {
              addSuffix: true,
            })
          : "—"}
      </span>
    ),
  },
]

export default function ContactsPage() {
  const navigate = useNavigate()
  const { companyId } = useCompany()
  const [search, setSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<string>("all")
  const [scoreFilter, setScoreFilter] = React.useState<string>("all")
  const [pushFilter, setPushFilter] = React.useState<string>("all")
  const [page, setPage] = React.useState(0)
  const [pageSize, setPageSize] = React.useState(50)

  const { data, isLoading } = useQuery({
    queryKey: [
      "enrichment-leads-search",
      companyId,
      search,
      statusFilter,
      scoreFilter,
      pushFilter,
      page,
      pageSize,
    ],
    queryFn: () =>
      api.searchEnrichmentLeads({
        q: search || undefined,
        company_id: companyId,
        status: statusFilter !== "all" ? statusFilter : undefined,
        score_label: scoreFilter !== "all" ? scoreFilter : undefined,
        instantly_push_status:
          pushFilter !== "all" ? pushFilter : undefined,
        limit: pageSize,
        offset: page * pageSize,
      }),
  })

  // Debounce search
  const searchTimeoutRef = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  const handleSearch = React.useCallback((val: string) => {
    clearTimeout(searchTimeoutRef.current)
    searchTimeoutRef.current = setTimeout(() => {
      setSearch(val)
      setPage(0)
    }, 300)
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Contacts</h1>
          <p className="text-sm text-muted-foreground">
            {data?.total ?? 0} total leads
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled>
            <UserPlus className="size-4 mr-1.5" />
            Import
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={statusFilter}
          onValueChange={(val) => {
            if (val != null) setStatusFilter(val)
            setPage(0)
          }}
        >
          <SelectTrigger className="w-[130px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="enriching">Enriching</SelectItem>
            <SelectItem value="enriched">Enriched</SelectItem>
            <SelectItem value="scored">Scored</SelectItem>
            <SelectItem value="pushed">Pushed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={scoreFilter}
          onValueChange={(val) => {
            if (val != null) setScoreFilter(val)
            setPage(0)
          }}
        >
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="Score" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Scores</SelectItem>
            <SelectItem value="hot">Hot</SelectItem>
            <SelectItem value="warm">Warm</SelectItem>
            <SelectItem value="cool">Cool</SelectItem>
            <SelectItem value="cold">Cold</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={pushFilter}
          onValueChange={(val) => {
            if (val != null) setPushFilter(val)
            setPage(0)
          }}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Cold Email" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Email</SelectItem>
            <SelectItem value="not_pushed">Not Pushed</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="pushed">Pushed</SelectItem>
            <SelectItem value="excluded">Excluded</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={data?.leads ?? []}
        searchPlaceholder="Search contacts by name, email, or company..."
        onSearchChange={handleSearch}
        onRowClick={(row) => navigate(`/contacts/${row.id}`)}
        isLoading={isLoading}
        manualPagination
        totalRows={data?.total ?? 0}
        pageSize={pageSize}
        pageIndex={page}
        onPaginationChange={(p) => {
          setPage(p.pageIndex)
          setPageSize(p.pageSize)
        }}
      />
    </div>
  )
}
