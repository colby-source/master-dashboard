import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { useCompany } from '../../contexts/CompanyContext';
import {
  FlaskConical,
  Loader2,
  Plus,
  Trophy,
  Pause,
  Play,
  CheckCircle2,
  BarChart3,
  ChevronLeft,
  X,
} from 'lucide-react';

type View = 'list' | 'detail' | 'create';

export function AbTestingPanel() {
  const { companyId } = useCompany();
  const [view, setView] = useState<View>('list');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  if (view === 'detail' && selectedId) {
    return <TestDetail id={selectedId} onBack={() => setView('list')} />;
  }

  if (view === 'create') {
    return <CreateTest companyId={companyId} onBack={() => setView('list')} />;
  }

  return (
    <TestList
      companyId={companyId}
      onSelect={(id) => { setSelectedId(id); setView('detail'); }}
      onCreate={() => setView('create')}
    />
  );
}

// ── Test List ─────────────────────────────────────────────────

function TestList({
  companyId,
  onSelect,
  onCreate,
}: {
  companyId?: number;
  onSelect: (id: number) => void;
  onCreate: () => void;
}) {
  const { data: tests, isLoading } = useQuery({
    queryKey: ['ab-tests', companyId],
    queryFn: () => api.getAbTests(companyId),
    refetchInterval: 15000,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-violet-400" />
          <h1 className="text-lg font-semibold">A/B Testing</h1>
        </div>
        <button
          onClick={onCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium"
        >
          <Plus className="h-4 w-4" /> New Test
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (tests ?? []).length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-8 text-center text-muted-foreground">
          <FlaskConical className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No A/B tests yet. Create one to start optimizing your outreach.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(tests ?? []).map((test: any) => (
            <div
              key={test.id}
              onClick={() => onSelect(test.id)}
              className="bg-card border border-border rounded-lg p-4 hover:bg-muted/30 cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium">{test.name}</h3>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span className="px-2 py-0.5 rounded bg-muted font-mono">{test.test_type}</span>
                    <span>{formatTime(test.created_at)}</span>
                  </div>
                </div>
                <StatusBadge status={test.status} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Test Detail ───────────────────────────────────────────────

function TestDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const queryClient = useQueryClient();

  const { data: test, isLoading } = useQuery({
    queryKey: ['ab-test', id],
    queryFn: () => api.getAbTest(id),
    refetchInterval: 10000,
  });

  const { data: winnerData } = useQuery({
    queryKey: ['ab-test-winner', id],
    queryFn: () => api.getAbTestWinner(id),
    enabled: !!test,
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => api.updateAbTestStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ab-test', id] });
      queryClient.invalidateQueries({ queryKey: ['ab-tests'] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!test) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>Test not found</p>
        <button onClick={onBack} className="text-sm text-violet-400 mt-2">Go back</button>
      </div>
    );
  }

  const variants = test.variants ?? [];
  const winner = winnerData?.winner;
  const totalLeads = variants.reduce((sum: number, v: any) => sum + (v.leads_assigned || 0), 0);
  const totalReplies = variants.reduce((sum: number, v: any) => sum + (v.replies_received || 0), 0);
  const totalPositive = variants.reduce((sum: number, v: any) => sum + (v.positive_replies || 0), 0);
  const totalMeetings = variants.reduce((sum: number, v: any) => sum + (v.meetings_booked || 0), 0);

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Back to tests
      </button>

      {/* Header */}
      <div className="bg-card border border-border rounded-lg p-5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold">{test.name ?? test.test?.name}</h2>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
              <span className="px-2 py-0.5 rounded bg-muted font-mono text-xs">{test.test_type ?? test.test?.test_type}</span>
              <span>{formatTime(test.created_at ?? test.test?.created_at)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={test.status ?? test.test?.status ?? 'active'} />
            {(test.status ?? test.test?.status) === 'active' && (
              <button
                onClick={() => statusMutation.mutate('paused')}
                className="flex items-center gap-1 px-2 py-1 rounded bg-yellow-600/20 text-yellow-400 text-xs hover:bg-yellow-600/30"
              >
                <Pause className="h-3 w-3" /> Pause
              </button>
            )}
            {(test.status ?? test.test?.status) === 'paused' && (
              <button
                onClick={() => statusMutation.mutate('active')}
                className="flex items-center gap-1 px-2 py-1 rounded bg-green-600/20 text-green-400 text-xs hover:bg-green-600/30"
              >
                <Play className="h-3 w-3" /> Resume
              </button>
            )}
            {(test.status ?? test.test?.status) !== 'completed' && (
              <button
                onClick={() => statusMutation.mutate('completed')}
                className="flex items-center gap-1 px-2 py-1 rounded bg-blue-600/20 text-blue-400 text-xs hover:bg-blue-600/30"
              >
                <CheckCircle2 className="h-3 w-3" /> Complete
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Leads Assigned" value={totalLeads} icon={BarChart3} />
        <StatCard label="Total Replies" value={totalReplies} icon={BarChart3} color="text-blue-400" />
        <StatCard label="Positive Replies" value={totalPositive} icon={BarChart3} color="text-green-400" />
        <StatCard label="Meetings Booked" value={totalMeetings} icon={Trophy} color="text-yellow-400" />
      </div>

      {/* Winner banner */}
      {winner && (
        <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 flex items-center gap-3">
          <Trophy className="h-5 w-5 text-green-400" />
          <div>
            <span className="font-medium text-green-400">Winning Variant: {winner.variant_name}</span>
            <span className="text-sm text-muted-foreground ml-2">— {winner.description}</span>
          </div>
        </div>
      )}

      {/* Variant breakdown */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium">Variants</h3>
        {variants.map((v: any) => {
          const replyRate = v.leads_assigned > 0 ? ((v.replies_received / v.leads_assigned) * 100).toFixed(1) : '0.0';
          const positiveRate = v.leads_assigned > 0 ? ((v.positive_replies / v.leads_assigned) * 100).toFixed(1) : '0.0';
          const meetingRate = v.leads_assigned > 0 ? ((v.meetings_booked / v.leads_assigned) * 100).toFixed(1) : '0.0';
          const isWinner = winner && winner.variant_name === v.variant_name;
          const config = safeJson(v.config);

          return (
            <div
              key={v.id}
              className={`bg-card border rounded-lg p-4 ${isWinner ? 'border-green-500/40' : 'border-border'}`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold">{v.variant_name}</span>
                  {v.description && <span className="text-sm text-muted-foreground">— {v.description}</span>}
                  {isWinner && <Trophy className="h-4 w-4 text-green-400" />}
                </div>
              </div>

              {config?.cta_instruction && (
                <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2 mb-3 italic">
                  "{config.cta_instruction}"
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                <MiniStat label="Leads" value={v.leads_assigned || 0} />
                <MiniStat label="Replies" value={v.replies_received || 0} pct={replyRate} />
                <MiniStat label="Positive" value={v.positive_replies || 0} pct={positiveRate} color="text-green-400" />
                <MiniStat label="Meetings" value={v.meetings_booked || 0} pct={meetingRate} color="text-yellow-400" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Create Test ───────────────────────────────────────────────

function CreateTest({ companyId, onBack }: { companyId?: number; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [testType, setTestType] = useState('cta_style');
  const [variants, setVariants] = useState([
    { variant_name: 'A', description: '', config: { cta_instruction: '' } },
    { variant_name: 'B', description: '', config: { cta_instruction: '' } },
  ]);

  const createMutation = useMutation({
    mutationFn: () =>
      api.createAbTest({
        name,
        test_type: testType,
        company_id: companyId,
        variants,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ab-tests'] });
      onBack();
    },
  });

  const addVariant = () => {
    const nextLetter = String.fromCharCode(65 + variants.length);
    setVariants([...variants, { variant_name: nextLetter, description: '', config: { cta_instruction: '' } }]);
  };

  const removeVariant = (index: number) => {
    if (variants.length <= 2) return;
    setVariants(variants.filter((_, i) => i !== index));
  };

  const updateVariant = (index: number, field: string, value: string) => {
    const updated = variants.map((v, i) => {
      if (i !== index) return v;
      if (field === 'cta_instruction') {
        return { ...v, config: { ...v.config, cta_instruction: value } };
      }
      return { ...v, [field]: value };
    });
    setVariants(updated);
  };

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-4 w-4" /> Back to tests
      </button>

      <div className="flex items-center gap-2">
        <FlaskConical className="h-5 w-5 text-violet-400" />
        <h1 className="text-lg font-semibold">Create A/B Test</h1>
      </div>

      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        <div>
          <label className="text-sm font-medium block mb-1">Test Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Calendar CTA Style"
            className="w-full px-3 py-1.5 bg-muted border border-border rounded text-sm"
          />
        </div>

        <div>
          <label className="text-sm font-medium block mb-1">Test Type</label>
          <select
            value={testType}
            onChange={(e) => setTestType(e.target.value)}
            className="bg-muted border border-border rounded px-3 py-1.5 text-sm"
          >
            <option value="cta_style">CTA Style</option>
            <option value="subject_line">Subject Line</option>
            <option value="email_body">Email Body</option>
            <option value="send_time">Send Time</option>
          </select>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium">Variants</label>
            {variants.length < 4 && (
              <button onClick={addVariant} className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1">
                <Plus className="h-3 w-3" /> Add Variant
              </button>
            )}
          </div>
          <div className="space-y-3">
            {variants.map((v, i) => (
              <div key={i} className="bg-muted/50 border border-border rounded p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold">Variant {v.variant_name}</span>
                  {variants.length > 2 && (
                    <button onClick={() => removeVariant(i)} className="text-muted-foreground hover:text-red-400">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={v.description}
                  onChange={(e) => updateVariant(i, 'description', e.target.value)}
                  placeholder="Description (e.g., Soft ask)"
                  className="w-full px-3 py-1.5 bg-background border border-border rounded text-sm"
                />
                <textarea
                  value={v.config.cta_instruction}
                  onChange={(e) => updateVariant(i, 'cta_instruction', e.target.value)}
                  placeholder="CTA instruction for Claude..."
                  rows={2}
                  className="w-full px-3 py-1.5 bg-background border border-border rounded text-sm resize-none"
                />
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={() => createMutation.mutate()}
          disabled={!name || createMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 rounded bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium disabled:opacity-50"
        >
          {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Create Test
        </button>

        {createMutation.isError && (
          <p className="text-sm text-red-400">Error: {(createMutation.error as any)?.message}</p>
        )}
      </div>
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

function MiniStat({ label, value, pct, color }: { label: string; value: number; pct?: string; color?: string }) {
  return (
    <div>
      <div className={`text-lg font-bold ${color ?? ''}`}>{value}</div>
      <div className="text-xs text-muted-foreground">
        {label} {pct && <span className="opacity-70">({pct}%)</span>}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'bg-green-500/10 text-green-400 border-green-500/20',
    paused: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    completed: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  };

  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${colors[status] ?? colors.active}`}>
      {status}
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
