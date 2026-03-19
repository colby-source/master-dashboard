import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useCompany } from '../../contexts/CompanyContext';
import {
  FileText,
  Loader2,
  ChevronLeft,
  User,
  Mail,
  Clock,
  RefreshCw,
  TrendingUp,
  MessageSquare,
  CheckCircle2,
  AlertCircle,
  Calendar,
  Video,
} from 'lucide-react';

type View = 'list' | 'detail';

export function MeetingTranscriptsPanel() {
  const { companyId } = useCompany();
  const [view, setView] = useState<View>('list');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  if (view === 'detail' && selectedId) {
    return <TranscriptDetail id={selectedId} onBack={() => setView('list')} />;
  }

  return (
    <TranscriptList
      companyId={companyId}
      onSelect={(id) => { setSelectedId(id); setView('detail'); }}
    />
  );
}

// ── Transcript List ──────────────────────────────────────────

function TranscriptList({
  companyId,
  onSelect,
}: {
  companyId?: number;
  onSelect: (id: number) => void;
}) {
  const { data: transcripts, isLoading } = useQuery({
    queryKey: ['meeting-transcripts', companyId],
    queryFn: () => api.getMeetingTranscripts(companyId),
    refetchInterval: 15000,
  });

  const list = transcripts ?? [];
  const analyzed = list.filter((t: any) => t.analysis).length;
  const synced = list.filter((t: any) => t.ghl_synced).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <FileText className="h-5 w-5 text-emerald-400" />
        <h1 className="text-lg font-semibold">Meeting Transcripts</h1>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Meetings" value={list.length} icon={Video} />
        <StatCard label="Analyzed" value={analyzed} icon={CheckCircle2} color="text-green-400" />
        <StatCard label="GHL Synced" value={synced} icon={TrendingUp} color="text-blue-400" />
        <StatCard label="Pending" value={list.length - analyzed} icon={Clock} color="text-yellow-400" />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : list.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-8 text-center text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No meeting transcripts yet.</p>
          <p className="text-xs mt-1">Transcripts arrive via the N8N webhook after meetings end.</p>
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-muted-foreground text-xs">
                <th className="text-left p-3">Lead</th>
                <th className="text-left p-3">Date</th>
                <th className="text-left p-3">Duration</th>
                <th className="text-left p-3">Sentiment</th>
                <th className="text-left p-3">Sequence</th>
                <th className="text-left p-3">GHL</th>
                <th className="text-left p-3">When</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t: any) => {
                const analysis = safeJson(t.analysis);
                return (
                  <tr
                    key={t.id}
                    className="border-b border-border/50 hover:bg-muted/30 cursor-pointer"
                    onClick={() => onSelect(t.id)}
                  >
                    <td className="p-3">
                      <span className="font-medium">
                        {t.first_name || t.last_name
                          ? `${t.first_name ?? ''} ${t.last_name ?? ''}`.trim()
                          : t.email ?? `Lead #${t.lead_id}`}
                      </span>
                    </td>
                    <td className="p-3 text-xs">{t.meeting_date ?? '—'}</td>
                    <td className="p-3 text-xs">{t.duration_minutes ? `${t.duration_minutes}m` : '—'}</td>
                    <td className="p-3">
                      {analysis?.sentiment ? (
                        <SentimentBadge sentiment={analysis.sentiment} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3">
                      {t.sequence_assigned ? (
                        <SequenceBadge sequence={t.sequence_assigned} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="p-3">
                      {t.ghl_synced ? (
                        <CheckCircle2 className="h-4 w-4 text-green-400" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-muted-foreground/40" />
                      )}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                      {formatTime(t.created_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Transcript Detail ────────────────────────────────────────

function TranscriptDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const queryClient = useQueryClient();

  const { data: transcript, isLoading } = useQuery({
    queryKey: ['meeting-transcript', id],
    queryFn: () => api.getMeetingTranscript(id),
  });

  const reprocessMutation = useMutation({
    mutationFn: () => api.reprocessMeetingTranscript(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['meeting-transcript', id] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!transcript) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>Transcript not found</p>
        <button onClick={onBack} className="text-sm text-emerald-400 mt-2">Go back</button>
      </div>
    );
  }

  const t = transcript;
  const analysis = safeJson(t.analysis);
  const nextSteps = safeJson(t.next_steps);
  const attendees = safeJson(t.attendees);

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Back to transcripts
      </button>

      {/* Header */}
      <div className="bg-card border border-border rounded-lg p-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold">
              {t.first_name || t.last_name
                ? `${t.first_name ?? ''} ${t.last_name ?? ''}`.trim()
                : `Meeting #${t.id}`}
            </h2>
            <div className="flex flex-wrap gap-3 mt-2 text-sm text-muted-foreground">
              {t.email && (
                <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{t.email}</span>
              )}
              {t.meeting_date && (
                <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{t.meeting_date}</span>
              )}
              {t.duration_minutes && (
                <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{t.duration_minutes} min</span>
              )}
              {t.platform && (
                <span className="flex items-center gap-1"><Video className="h-3.5 w-3.5" />{t.platform}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {t.sequence_assigned && <SequenceBadge sequence={t.sequence_assigned} />}
            {t.ghl_synced ? (
              <span className="text-xs px-2 py-0.5 rounded-full border bg-green-500/10 text-green-400 border-green-500/20">GHL Synced</span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full border bg-gray-500/10 text-gray-400 border-gray-500/20">Not Synced</span>
            )}
          </div>
        </div>
      </div>

      {/* Attendees */}
      {attendees && attendees.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="text-sm font-medium mb-2 flex items-center gap-1.5"><User className="h-4 w-4" /> Attendees</h3>
          <div className="flex flex-wrap gap-2">
            {attendees.map((a: string, i: number) => (
              <span key={i} className="text-xs px-2 py-1 rounded bg-muted">{a}</span>
            ))}
          </div>
        </div>
      )}

      {/* Claude Analysis */}
      {analysis ? (
        <div className="bg-card border border-border rounded-lg p-5 space-y-4">
          <h3 className="text-sm font-medium flex items-center gap-1.5">
            <MessageSquare className="h-4 w-4 text-violet-400" /> Claude Analysis
          </h3>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <span className="text-xs text-muted-foreground">Sentiment</span>
              <div className="mt-0.5"><SentimentBadge sentiment={analysis.sentiment} /></div>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Investment Likelihood</span>
              <div className="text-lg font-bold mt-0.5">{analysis.investment_likelihood ?? '—'}%</div>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Accredited</span>
              <div className="text-sm font-medium mt-0.5">{analysis.accredited_confirmed ? 'Yes' : analysis.accredited_confirmed === false ? 'No' : '—'}</div>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Timeline</span>
              <div className="text-sm font-medium mt-0.5">{analysis.investment_timeline ?? '—'}</div>
            </div>
          </div>

          {analysis.key_topics && analysis.key_topics.length > 0 && (
            <div>
              <span className="text-xs text-muted-foreground">Key Topics</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {analysis.key_topics.map((topic: string, i: number) => (
                  <span key={i} className="text-xs px-2 py-0.5 rounded bg-violet-500/10 text-violet-400 border border-violet-500/20">
                    {topic}
                  </span>
                ))}
              </div>
            </div>
          )}

          {analysis.objections && analysis.objections.length > 0 && (
            <div>
              <span className="text-xs text-muted-foreground">Objections</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {analysis.objections.map((obj: string, i: number) => (
                  <span key={i} className="text-xs px-2 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">
                    {obj}
                  </span>
                ))}
              </div>
            </div>
          )}

          {analysis.personalized_follow_up && (
            <div>
              <span className="text-xs text-muted-foreground">Personalized Follow-Up</span>
              <div className="text-sm bg-muted/50 rounded p-3 mt-1 italic">{analysis.personalized_follow_up}</div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-card border border-border rounded-lg p-5 text-center text-muted-foreground">
          <p className="text-sm">No analysis yet.</p>
          <button
            onClick={() => reprocessMutation.mutate()}
            disabled={reprocessMutation.isPending}
            className="mt-2 flex items-center gap-1.5 mx-auto px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm"
          >
            {reprocessMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Run Analysis
          </button>
        </div>
      )}

      {/* Next Steps */}
      {nextSteps && (Array.isArray(nextSteps) ? nextSteps.length > 0 : analysis?.next_steps?.length > 0) && (
        <div className="bg-card border border-border rounded-lg p-5">
          <h3 className="text-sm font-medium mb-2">Next Steps</h3>
          <ul className="space-y-1.5">
            {(Array.isArray(nextSteps) ? nextSteps : analysis?.next_steps ?? []).map((step: string, i: number) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                <span>{step}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Transcript text */}
      {t.transcript_text && (
        <div className="bg-card border border-border rounded-lg p-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium">Transcript</h3>
            <button
              onClick={() => reprocessMutation.mutate()}
              disabled={reprocessMutation.isPending}
              className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"
            >
              <RefreshCw className={`h-3 w-3 ${reprocessMutation.isPending ? 'animate-spin' : ''}`} />
              Reprocess
            </button>
          </div>
          <pre className="text-xs text-muted-foreground bg-muted/50 rounded p-3 max-h-96 overflow-y-auto whitespace-pre-wrap">
            {t.transcript_text}
          </pre>
        </div>
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

function SentimentBadge({ sentiment }: { sentiment: string }) {
  const colors: Record<string, string> = {
    very_interested: 'bg-green-500/10 text-green-400 border-green-500/20',
    interested: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    lukewarm: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    not_interested: 'bg-red-500/10 text-red-400 border-red-500/20',
  };
  const label = sentiment.replace(/_/g, ' ');

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border capitalize ${colors[sentiment] ?? colors.lukewarm}`}>
      {label}
    </span>
  );
}

function SequenceBadge({ sequence }: { sequence: string }) {
  const colors: Record<string, string> = {
    closing: 'bg-green-500/10 text-green-400 border-green-500/20',
    nurture: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    re_engagement: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  };

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border capitalize ${colors[sequence] ?? 'bg-muted text-muted-foreground border-border'}`}>
      {sequence.replace(/_/g, ' ')}
    </span>
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
