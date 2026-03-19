import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useCompany } from '../../contexts/CompanyContext';
import {
  Eye,
  Loader2,
  Search,
  User,
  Flame,
  TrendingUp,
  ExternalLink,
  ChevronLeft,
  Globe,
  Mail,
  Phone,
  Building2,
  Clock,
} from 'lucide-react';

type View = 'list' | 'detail';

export function Rb2bPanel() {
  const { companyId } = useCompany();
  const [view, setView] = useState<View>('list');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const openDetail = (id: number) => {
    setSelectedId(id);
    setView('detail');
  };

  if (view === 'detail' && selectedId) {
    return <VisitorDetail id={selectedId} onBack={() => setView('list')} />;
  }

  return (
    <VisitorList
      companyId={companyId}
      search={search}
      setSearch={setSearch}
      statusFilter={statusFilter}
      setStatusFilter={setStatusFilter}
      page={page}
      setPage={setPage}
      pageSize={pageSize}
      onSelect={openDetail}
    />
  );
}

// ── Visitor List ─────────────────────────────────────────────

function VisitorList({
  companyId,
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  page,
  setPage,
  pageSize,
  onSelect,
}: {
  companyId?: number;
  search: string;
  setSearch: (s: string) => void;
  statusFilter: string;
  setStatusFilter: (s: string) => void;
  page: number;
  setPage: (p: number) => void;
  pageSize: number;
  onSelect: (id: number) => void;
}) {
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['rb2b-stats', companyId],
    queryFn: () => api.getRb2bStats(companyId),
    refetchInterval: 30000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['rb2b-visitors', companyId, search, statusFilter, page],
    queryFn: () =>
      api.getRb2bVisitors({
        limit: pageSize,
        offset: page * pageSize,
        company_id: companyId,
        search: search || undefined,
        status: statusFilter || undefined,
      }),
    refetchInterval: 15000,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Eye className="h-5 w-5 text-purple-400" />
        <h1 className="text-lg font-semibold">RB2B Visitor Intelligence</h1>
      </div>

      {/* Stats cards */}
      {!statsLoading && stats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Total Visitors" value={stats.total} icon={User} />
          <StatCard label="Today" value={stats.today} icon={TrendingUp} color="text-blue-400" />
          <StatCard label="This Week" value={stats.thisWeek} icon={TrendingUp} color="text-cyan-400" />
          <StatCard label="Enriched" value={stats.enriched} icon={Search} color="text-green-400" />
          <StatCard label="Scored" value={stats.scored} icon={TrendingUp} color="text-yellow-400" />
          <StatCard label="Hot Leads" value={stats.hotLeads} icon={Flame} color="text-red-400" />
        </div>
      )}

      {/* Top pages */}
      {stats?.topPages && stats.topPages.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="text-sm font-medium mb-2">Top Visited Pages</h3>
          <div className="space-y-1">
            {stats.topPages.slice(0, 5).map((p: any) => (
              <div key={p.page_url} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1 text-muted-foreground truncate max-w-[80%]">
                  <Globe className="h-3 w-3 shrink-0" />
                  <span className="truncate">{p.page_url}</span>
                </div>
                <span className="font-bold">{p.visits}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search & Filter */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search visitors..."
            className="w-full pl-9 pr-3 py-1.5 bg-muted border border-border rounded text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
          className="bg-muted border border-border rounded px-3 py-1.5 text-sm"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="enriching">Enriching</option>
          <option value="enriched">Enriched</option>
          <option value="scored">Scored</option>
          <option value="pushed">Pushed</option>
          <option value="failed">Failed</option>
        </select>
        <span className="text-xs text-muted-foreground ml-auto">{data?.total ?? 0} visitors</span>
      </div>

      {/* Visitor table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs">
                <th className="text-left p-3">Visitor</th>
                <th className="text-left p-3">Email</th>
                <th className="text-left p-3">Company</th>
                <th className="text-left p-3">Page Visited</th>
                <th className="text-left p-3">Score</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">When</th>
              </tr>
            </thead>
            <tbody>
              {(data?.visitors ?? []).map((v: any) => {
                const visitData = safeJson(v.first_visit_data);
                return (
                  <tr
                    key={v.id}
                    className="border-b border-border/50 hover:bg-muted/30 cursor-pointer"
                    onClick={() => onSelect(v.id)}
                  >
                    <td className="p-3">
                      <span className="font-medium">{v.first_name} {v.last_name}</span>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">{v.email ?? '—'}</td>
                    <td className="p-3 text-xs">{v.company_name || visitData?.company || '—'}</td>
                    <td className="p-3 text-xs text-muted-foreground truncate max-w-[200px]">
                      {visitData?.page_url ?? '—'}
                    </td>
                    <td className="p-3">
                      {v.score != null ? (
                        <ScoreBadge score={v.score} label={v.score_label} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3">
                      <StatusBadge status={v.status} />
                    </td>
                    <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                      {formatTime(v.created_at)}
                    </td>
                  </tr>
                );
              })}
              {(data?.visitors ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground text-sm">
                    No RB2B visitors found
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {(data?.total ?? 0) > pageSize && (
            <div className="flex items-center justify-between p-3 border-t border-border text-xs">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0}
                className="px-2 py-1 rounded bg-muted hover:bg-muted/80 disabled:opacity-30"
              >
                Previous
              </button>
              <span className="text-muted-foreground">
                Page {page + 1} of {Math.ceil((data?.total ?? 0) / pageSize)}
              </span>
              <button
                onClick={() => setPage(page + 1)}
                disabled={(page + 1) * pageSize >= (data?.total ?? 0)}
                className="px-2 py-1 rounded bg-muted hover:bg-muted/80 disabled:opacity-30"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Visitor Detail ───────────────────────────────────────────

function VisitorDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['rb2b-visitor', id],
    queryFn: () => api.getRb2bVisitor(id),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const v = data?.visitor;
  const events = data?.events ?? [];
  const enrichment = safeJson(v?.enrichment_data);

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Back to visitors
      </button>

      {v && (
        <>
          {/* Header */}
          <div className="bg-card border border-border rounded-lg p-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-semibold">{v.first_name} {v.last_name}</h2>
                <div className="flex flex-wrap gap-3 mt-2 text-sm text-muted-foreground">
                  {v.email && (
                    <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{v.email}</span>
                  )}
                  {v.phone && (
                    <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{v.phone}</span>
                  )}
                  {(v.company_name || enrichment?.company?.name) && (
                    <span className="flex items-center gap-1">
                      <Building2 className="h-3.5 w-3.5" />{v.company_name || enrichment?.company?.name}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {v.score != null && <ScoreBadge score={v.score} label={v.score_label} />}
                <StatusBadge status={v.status} />
              </div>
            </div>
          </div>

          {/* Enrichment data */}
          {enrichment && (
            <div className="bg-card border border-border rounded-lg p-5">
              <h3 className="text-sm font-medium mb-3">Enrichment Data</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                {enrichment.job_title && <DetailField label="Title" value={enrichment.job_title} />}
                {enrichment.linkedin_url && (
                  <DetailField label="LinkedIn" value={
                    <a href={enrichment.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline flex items-center gap-1">
                      Profile <ExternalLink className="h-3 w-3" />
                    </a>
                  } />
                )}
                {enrichment.company?.industry && <DetailField label="Industry" value={enrichment.company.industry} />}
                {enrichment.company?.size && <DetailField label="Company Size" value={enrichment.company.size} />}
                {enrichment.company?.location?.name && <DetailField label="Location" value={enrichment.company.location.name} />}
                {enrichment.company?.website && <DetailField label="Website" value={enrichment.company.website} />}
              </div>
              {v.score_reasoning && (
                <div className="mt-3 text-xs text-muted-foreground bg-muted/50 rounded p-3">
                  <strong>Score Reasoning:</strong> {v.score_reasoning}
                </div>
              )}
            </div>
          )}

          {/* Event timeline */}
          <div className="bg-card border border-border rounded-lg p-5">
            <h3 className="text-sm font-medium mb-3">Activity Timeline</h3>
            <div className="space-y-3">
              {events.map((evt: any) => {
                const evtData = safeJson(evt.event_data);
                return (
                  <div key={evt.id} className="flex items-start gap-3 text-sm">
                    <div className="mt-0.5">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted font-mono">{evt.event_type}</span>
                        <span className="text-xs text-muted-foreground">{formatTime(evt.created_at)}</span>
                      </div>
                      {evtData?.page_url && (
                        <div className="text-xs text-muted-foreground mt-1">Page: {evtData.page_url}</div>
                      )}
                    </div>
                  </div>
                );
              })}
              {events.length === 0 && (
                <div className="text-sm text-muted-foreground text-center py-4">No events recorded</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Shared Components ────────────────────────────────────────

function StatCard({ label, value, icon: Icon, color }: { label: string; value: number; icon: any; color?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-3 text-center">
      <Icon className={`h-4 w-4 mx-auto mb-1 ${color ?? 'text-muted-foreground'}`} />
      <div className="text-xl font-bold">{value ?? 0}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function ScoreBadge({ score, label }: { score: number; label?: string }) {
  const color = label === 'hot' ? 'bg-red-500/10 text-red-400 border-red-500/20'
    : label === 'warm' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
    : 'bg-blue-500/10 text-blue-400 border-blue-500/20';

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${color}`}>
      {Math.round(score)} {label ? `(${label})` : ''}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
    enriching: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    enriched: 'bg-green-500/10 text-green-400 border-green-500/20',
    scored: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    pushed: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    failed: 'bg-red-500/10 text-red-400 border-red-500/20',
  };

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${colors[status] ?? colors.pending}`}>
      {status}
    </span>
  );
}

function DetailField({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

function safeJson(str: string | null | undefined): any {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

function formatTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 60000) return 'just now';
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
  if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`;
  return d.toLocaleDateString();
}
