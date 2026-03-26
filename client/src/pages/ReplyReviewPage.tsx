import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useCompany } from "@/contexts/CompanyContext"
import { api } from "@/lib/api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Check, X, Edit2, ChevronDown, ChevronUp, CheckCheck, XCircle } from "lucide-react"

interface Message {
  id: number
  direction: "inbound" | "outbound"
  body: string
  sentiment: string | null
  generated_by: string | null
  created_at: string
}

interface Draft {
  id: number
  thread_id: number
  body: string
  sentiment: string | null
  strategy: string | null
  review_status: string
  scheduled_at: string | null
  created_at: string
  thread_email: string
  thread_subject: string | null
  company_id: number
  company_name: string | null
  first_name: string | null
  last_name: string | null
  score: number | null
  score_label: string | null
  conversation: Message[]
}

function sentimentColor(s: string | null): "default" | "secondary" | "destructive" | "outline" {
  if (!s) return "outline"
  if (["positive", "interested", "meeting_request"].includes(s)) return "default"
  if (["negative", "not_interested", "do_not_contact"].includes(s)) return "destructive"
  return "secondary"
}

function formatTime(iso: string | null) {
  if (!iso) return ""
  const d = new Date(iso)
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
}

function stripHtml(html: string) {
  const div = document.createElement("div")
  div.innerHTML = html
  return div.textContent || div.innerText || html
}

function DraftCard({
  draft,
  selected,
  onToggleSelect,
  onApprove,
  onReject,
  onEdit,
}: {
  draft: Draft
  selected: boolean
  onToggleSelect: () => void
  onApprove: () => void
  onReject: () => void
  onEdit: (body: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editBody, setEditBody] = useState(draft.body)

  const inbound = draft.conversation.filter((m) => m.direction === "inbound")
  const lastInbound = inbound[inbound.length - 1]
  const leadName = [draft.first_name, draft.last_name].filter(Boolean).join(" ") || draft.thread_email

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/30">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="h-4 w-4 rounded border-border"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">{leadName}</span>
            <span className="text-muted-foreground text-sm truncate">{draft.thread_email}</span>
            {draft.score_label && (
              <Badge variant="outline" className="text-xs">{draft.score_label}</Badge>
            )}
            {draft.sentiment && (
              <Badge variant={sentimentColor(draft.sentiment)} className="text-xs">
                {draft.sentiment.replace(/_/g, " ")}
              </Badge>
            )}
          </div>
          {draft.company_name && (
            <span className="text-xs text-muted-foreground">{draft.company_name}</span>
          )}
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {formatTime(draft.created_at)}
        </span>
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1 hover:bg-muted rounded"
          title="Show conversation history"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {/* Conversation history (collapsed by default) */}
      {expanded && draft.conversation.length > 0 && (
        <div className="px-4 py-3 border-b border-border bg-muted/10 space-y-3 max-h-80 overflow-y-auto">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Conversation History</div>
          {draft.conversation
            .filter((m) => m.id !== draft.id)
            .map((m) => (
              <div
                key={m.id}
                className={`text-sm rounded-lg px-3 py-2 ${
                  m.direction === "inbound"
                    ? "bg-blue-500/10 border border-blue-500/20"
                    : "bg-green-500/10 border border-green-500/20 ml-8"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium">
                    {m.direction === "inbound" ? "Lead" : "Us"}
                  </span>
                  <span className="text-xs text-muted-foreground">{formatTime(m.created_at)}</span>
                  {m.sentiment && (
                    <Badge variant={sentimentColor(m.sentiment)} className="text-[10px] h-4">
                      {m.sentiment.replace(/_/g, " ")}
                    </Badge>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{stripHtml(m.body)}</p>
              </div>
            ))}
        </div>
      )}

      {/* Last inbound message (always visible) */}
      {lastInbound && !expanded && (
        <div className="px-4 py-2 border-b border-border bg-blue-500/5">
          <div className="text-xs font-medium text-muted-foreground mb-1">Their message:</div>
          <p className="text-sm whitespace-pre-wrap line-clamp-3">{stripHtml(lastInbound.body)}</p>
        </div>
      )}

      {/* Draft response */}
      <div className="px-4 py-3">
        <div className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-2">
          AI Draft Response
          {draft.strategy && (
            <Badge variant="outline" className="text-[10px] h-4">{draft.strategy}</Badge>
          )}
        </div>
        {editing ? (
          <div className="space-y-2">
            <textarea
              value={editBody}
              onChange={(e) => setEditBody(e.target.value)}
              className="w-full min-h-[120px] bg-background border border-border rounded-md p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-y"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  onEdit(editBody)
                  setEditing(false)
                }}
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEditBody(draft.body)
                  setEditing(false)
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm whitespace-pre-wrap bg-green-500/5 border border-green-500/10 rounded-md p-3 leading-relaxed">
            {stripHtml(draft.body)}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="px-4 py-2 border-t border-border flex gap-2 justify-end">
        {!editing && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Edit2 className="h-3 w-3 mr-1" />
            Edit
          </Button>
        )}
        <Button size="sm" variant="outline" className="text-red-500 hover:text-red-600" onClick={onReject}>
          <X className="h-3 w-3 mr-1" />
          Reject
        </Button>
        <Button size="sm" onClick={onApprove}>
          <Check className="h-3 w-3 mr-1" />
          Approve
        </Button>
      </div>
    </div>
  )
}

export default function ReplyReviewPage() {
  const { companyId } = useCompany()
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState("pending_review")
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())

  const { data, isLoading, error } = useQuery({
    queryKey: ["reply-drafts", companyId, statusFilter],
    queryFn: () => api.getReplyDrafts({ company_id: companyId || undefined, review_status: statusFilter, limit: 100 }),
    refetchInterval: 15000,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["reply-drafts"] })
    setSelectedIds(new Set())
  }

  const approveMutation = useMutation({
    mutationFn: (id: number) => api.approveReplyDraft(id),
    onSuccess: invalidate,
  })

  const rejectMutation = useMutation({
    mutationFn: (id: number) => api.rejectReplyDraft(id),
    onSuccess: invalidate,
  })

  const editMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: string }) => api.editReplyDraft(id, body),
    onSuccess: invalidate,
  })

  const bulkMutation = useMutation({
    mutationFn: ({ ids, action }: { ids: number[]; action: "approve" | "reject" }) =>
      api.bulkActionReplyDrafts(ids, action),
    onSuccess: invalidate,
  })

  const drafts: Draft[] = data?.drafts ?? []
  const total: number = data?.total ?? 0

  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selectedIds.size === drafts.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(drafts.map((d) => d.id)))
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Reply Review Queue</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review AI-generated responses before they are sent
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-background border border-border rounded-md px-3 py-1.5 text-sm"
          >
            <option value="pending_review">Pending Review ({statusFilter === "pending_review" ? total : "..."})</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </div>

      {/* Bulk actions */}
      {selectedIds.size > 0 && statusFilter === "pending_review" && (
        <div className="flex items-center gap-3 bg-muted/50 border border-border rounded-lg px-4 py-2">
          <span className="text-sm font-medium">{selectedIds.size} selected</span>
          <Button
            size="sm"
            onClick={() => bulkMutation.mutate({ ids: [...selectedIds], action: "approve" })}
            disabled={bulkMutation.isPending}
          >
            <CheckCheck className="h-3 w-3 mr-1" />
            Approve All
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-red-500"
            onClick={() => bulkMutation.mutate({ ids: [...selectedIds], action: "reject" })}
            disabled={bulkMutation.isPending}
          >
            <XCircle className="h-3 w-3 mr-1" />
            Reject All
          </Button>
        </div>
      )}

      {/* Select all checkbox */}
      {drafts.length > 0 && statusFilter === "pending_review" && (
        <div className="flex items-center gap-2 px-1">
          <input
            type="checkbox"
            checked={selectedIds.size === drafts.length && drafts.length > 0}
            onChange={toggleAll}
            className="h-4 w-4 rounded border-border"
          />
          <span className="text-xs text-muted-foreground">Select all ({drafts.length})</span>
        </div>
      )}

      {/* Loading / Error / Empty states */}
      {isLoading && (
        <div className="text-center py-12 text-muted-foreground">Loading drafts...</div>
      )}
      {error && (
        <div className="text-center py-12 text-red-500">
          Error loading drafts: {(error as Error).message}
        </div>
      )}
      {!isLoading && !error && drafts.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          {statusFilter === "pending_review"
            ? "No drafts pending review. All clear!"
            : `No ${statusFilter} drafts found.`}
        </div>
      )}

      {/* Draft cards */}
      <div className="space-y-4">
        {drafts.map((draft) => (
          <DraftCard
            key={draft.id}
            draft={draft}
            selected={selectedIds.has(draft.id)}
            onToggleSelect={() => toggleSelect(draft.id)}
            onApprove={() => approveMutation.mutate(draft.id)}
            onReject={() => rejectMutation.mutate(draft.id)}
            onEdit={(body) => editMutation.mutate({ id: draft.id, body })}
          />
        ))}
      </div>

      {/* Pagination info */}
      {total > drafts.length && (
        <div className="text-center text-sm text-muted-foreground">
          Showing {drafts.length} of {total} drafts
        </div>
      )}
    </div>
  )
}
