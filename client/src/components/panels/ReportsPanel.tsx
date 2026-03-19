import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import {
  Mail,
  Send,
  Loader2,
  FileText,
  CheckCircle2,
  XCircle,
  Clock,
  Eye,
  ChevronLeft,
} from 'lucide-react';

type View = 'list' | 'detail' | 'preview';

interface ReportSummary {
  id: number;
  report_date: string;
  report_type: string;
  sent_to: string;
  sent_at: string | null;
  error: string | null;
  created_at: string;
}

export function ReportsPanel() {
  const [view, setView] = useState<View>('list');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['reports'],
    queryFn: () => api.getReports(),
    refetchInterval: 30_000,
  });

  const previewQuery = useQuery({
    queryKey: ['report-preview'],
    queryFn: () => api.getReportPreview('evening'),
    enabled: view === 'preview',
  });

  const sendNow = useMutation({
    mutationFn: (type: string) => api.sendReport(type),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    },
  });

  if (view === 'detail' && selectedId) {
    return <ReportDetail id={selectedId} onBack={() => setView('list')} />;
  }

  if (view === 'preview') {
    return (
      <div className="space-y-4">
        <button
          onClick={() => setView('list')}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-4 h-4" /> Back to Reports
        </button>
        {previewQuery.isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Generating preview...
          </div>
        ) : previewQuery.data?.html ? (
          <div className="rounded-lg border bg-white overflow-hidden">
            <iframe
              srcDoc={previewQuery.data.html}
              className="w-full border-0"
              style={{ minHeight: 600 }}
              title="Report Preview"
            />
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">Failed to generate preview.</p>
        )}
      </div>
    );
  }

  const reports: ReportSummary[] = data?.reports || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Daily Reports</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Automated Meta lead reports — 8 AM + 6 PM ET
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView('preview')}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg hover:bg-muted transition-colors"
          >
            <Eye className="w-4 h-4" /> Preview
          </button>
          <button
            onClick={() => sendNow.mutate('evening')}
            disabled={sendNow.isPending}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {sendNow.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            Send Now
          </button>
        </div>
      </div>

      {sendNow.isSuccess && (
        <div className="flex items-center gap-2 p-3 text-sm bg-green-500/10 text-green-600 border border-green-500/20 rounded-lg">
          <CheckCircle2 className="w-4 h-4" /> Report generated and sent successfully.
        </div>
      )}

      {sendNow.isError && (
        <div className="flex items-center gap-2 p-3 text-sm bg-red-500/10 text-red-600 border border-red-500/20 rounded-lg">
          <XCircle className="w-4 h-4" /> Failed to send report. Check SMTP config.
        </div>
      )}

      {/* Report History */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading reports...
        </div>
      ) : reports.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <Mail className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>No reports yet. Click "Send Now" to generate your first report.</p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left p-3 font-medium text-muted-foreground">Date</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Type</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Sent To</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
                <th className="text-right p-3 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="p-3 font-medium">{formatDate(r.report_date)}</td>
                  <td className="p-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                      r.report_type === 'morning'
                        ? 'bg-amber-500/10 text-amber-600'
                        : 'bg-blue-500/10 text-blue-600'
                    }`}>
                      <Clock className="w-3 h-3" />
                      {r.report_type === 'morning' ? 'AM Recap' : 'PM Summary'}
                    </span>
                  </td>
                  <td className="p-3 text-muted-foreground">{r.sent_to}</td>
                  <td className="p-3">
                    {r.error ? (
                      <span className="flex items-center gap-1 text-red-500 text-xs">
                        <XCircle className="w-3.5 h-3.5" /> Failed
                      </span>
                    ) : r.sent_at ? (
                      <span className="flex items-center gap-1 text-green-500 text-xs">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Sent
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-muted-foreground text-xs">
                        <FileText className="w-3.5 h-3.5" /> Stored
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => { setSelectedId(r.id); setView('detail'); }}
                      className="text-xs text-primary hover:underline"
                    >
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Report Detail ──────────────────────────────────────────────

function ReportDetail({ id, onBack }: { id: number; onBack: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['report', id],
    queryFn: () => api.getReport(id),
  });

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="w-4 h-4" /> Back to Reports
      </button>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading report...
        </div>
      ) : data?.html ? (
        <div className="rounded-lg border bg-white overflow-hidden">
          <div className="p-3 border-b bg-muted/50 flex items-center justify-between text-sm">
            <span className="font-medium">
              {data.report_type === 'morning' ? 'Morning Recap' : 'Evening Summary'} — {formatDate(data.report_date)}
            </span>
            {data.sent_at && (
              <span className="text-muted-foreground text-xs">
                Sent {new Date(data.sent_at).toLocaleString()}
              </span>
            )}
          </div>
          <iframe
            srcDoc={data.html}
            className="w-full border-0"
            style={{ minHeight: 600 }}
            title="Report"
          />
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">Report not found.</p>
      )}
    </div>
  );
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}
