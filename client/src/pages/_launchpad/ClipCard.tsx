import type { ClipDto } from './_types';

interface Props {
  clip: ClipDto;
  onApprove: () => void;
  onReject: () => void;
  onReassign: (day: number | null) => void;
  onRegenerate: () => void;
}

const STATUS_BORDER: Record<string, { border: string; bg: string }> = {
  pending:      { border: 'rgba(245,158,11,0.40)', bg: 'rgba(254,243,199,0.55)' },
  approved:     { border: 'rgba(16,185,129,0.40)', bg: 'rgba(209,250,229,0.45)' },
  rejected:     { border: 'rgba(239,68,68,0.35)',  bg: 'rgba(254,226,226,0.50)'  },
  regenerating: { border: 'rgba(168,85,247,0.40)', bg: 'rgba(243,232,255,0.55)' },
};

const STATUS_LABEL: Record<string, { color: string; bg: string; text: string }> = {
  pending:      { color: 'rgb(146,64,14)',  bg: 'rgba(245,158,11,0.18)', text: 'pending'      },
  approved:     { color: 'rgb(5,122,85)',   bg: 'rgba(16,185,129,0.18)', text: 'approved ✓'   },
  rejected:     { color: 'rgb(190,18,60)',  bg: 'rgba(239,68,68,0.16)',  text: 'rejected'     },
  regenerating: { color: 'rgb(107,33,168)', bg: 'rgba(168,85,247,0.18)', text: 'regenerating' },
};

export function ClipCard({ clip, onApprove, onReject, onReassign, onRegenerate }: Props) {
  const style = STATUS_BORDER[clip.approvalStatus] ?? { border: '#E2E8F0', bg: '#FFFFFF' };
  const label = STATUS_LABEL[clip.approvalStatus];

  return (
    <div
      className="rounded-2xl p-5 transition-all duration-200"
      style={{ border: `1px solid ${style.border}`, background: style.bg, boxShadow: '0 1px 2px rgba(15,23,42,0.04)' }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-slate-500">
            {clip.format} · pillar {clip.pillarNumber} · {clip.clipType.replace(/_/g, ' ')}
          </div>
          {label && (
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider"
              style={{ color: label.color, background: label.bg }}
            >
              {label.text}
            </span>
          )}
        </div>
        <select
          value={clip.assignedDay ?? ''}
          onChange={(e) => onReassign(e.target.value === '' ? null : parseInt(e.target.value))}
          className="text-[11px] bg-white border border-slate-200 hover:border-slate-300 text-slate-700 rounded-lg px-2 py-1 outline-none focus:border-[#0A9396]"
        >
          <option value="">No day</option>
          {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>Day {d}</option>
          ))}
        </select>
      </div>

      <div className="text-slate-900 font-semibold mb-2 leading-snug">{clip.hook}</div>

      <div className="text-slate-700 text-sm whitespace-pre-wrap mb-3 max-h-40 overflow-auto leading-relaxed">
        {clip.body}
      </div>

      {clip.cta && (
        <div className="text-slate-500 text-xs italic mb-1">CTA: {clip.cta}</div>
      )}
      {clip.visualDirection && (
        <div className="text-slate-500 text-xs">Visual: {clip.visualDirection}</div>
      )}

      {clip.driveFileUrl && (
        <a
          href={clip.driveFileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-xs underline mt-3 transition-colors hover:opacity-80"
          style={{ color: '#016F74' }}
        >
          ▶ Open clip ↗
        </a>
      )}

      {clip.approvalStatus === 'pending' && (
        <div className="flex flex-wrap gap-2 mt-4">
          <button
            onClick={onApprove}
            className="px-4 py-1.5 text-xs font-semibold rounded-full transition-all duration-200 hover:scale-[1.03]"
            style={{ background: 'rgba(16,185,129,0.18)', color: 'rgb(5,122,85)', border: '1px solid rgba(16,185,129,0.45)' }}
          >
            Approve ✓
          </button>
          <button
            onClick={onReject}
            className="px-4 py-1.5 text-xs font-medium rounded-full bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 text-slate-700 hover:text-slate-900 transition-all duration-200"
          >
            Reject + ask for fix
          </button>
          <button
            onClick={onRegenerate}
            className="px-4 py-1.5 text-xs font-medium rounded-full transition-all duration-200 hover:scale-[1.03]"
            style={{ background: 'rgba(168,85,247,0.16)', color: 'rgb(107,33,168)', border: '1px solid rgba(168,85,247,0.40)' }}
          >
            ↻ Regenerate
          </button>
        </div>
      )}

      {clip.approvalStatus === 'regenerating' && (
        <div className="mt-3 text-xs flex items-center gap-2" style={{ color: 'rgb(107,33,168)' }}>
          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'rgb(168,85,247)' }} />
          Regenerating…
        </div>
      )}

      {clip.approvalStatus === 'rejected' && clip.approvalFeedback && (
        <div
          className="mt-3 text-xs px-3 py-2 rounded-lg"
          style={{ background: 'rgba(239,68,68,0.10)', color: 'rgb(190,18,60)' }}
        >
          Note: {clip.approvalFeedback}
        </div>
      )}
    </div>
  );
}
