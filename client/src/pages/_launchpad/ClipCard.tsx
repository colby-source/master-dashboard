import type { ClipDto } from './_types';

interface Props {
  clip: ClipDto;
  onApprove: () => void;
  onReject: () => void;
  onReassign: (day: number | null) => void;
  onRegenerate: () => void;
}

const STATUS_BORDER: Record<string, { border: string; bg: string }> = {
  pending:      { border: 'rgba(245,158,11,0.25)', bg: 'rgba(245,158,11,0.04)' },
  approved:     { border: 'rgba(16,185,129,0.25)', bg: 'rgba(16,185,129,0.04)' },
  rejected:     { border: 'rgba(239,68,68,0.25)',  bg: 'rgba(239,68,68,0.04)'  },
  regenerating: { border: 'rgba(168,85,247,0.30)', bg: 'rgba(168,85,247,0.05)' },
};

const STATUS_LABEL: Record<string, { color: string; bg: string; text: string }> = {
  pending:      { color: 'rgb(252,211,77)',  bg: 'rgba(245,158,11,0.12)', text: 'pending'      },
  approved:     { color: 'rgb(110,231,183)', bg: 'rgba(16,185,129,0.12)', text: 'approved ✓'   },
  rejected:     { color: 'rgb(252,165,165)', bg: 'rgba(239,68,68,0.12)',  text: 'rejected'     },
  regenerating: { color: 'rgb(216,180,254)', bg: 'rgba(168,85,247,0.14)', text: 'regenerating' },
};

export function ClipCard({ clip, onApprove, onReject, onReassign, onRegenerate }: Props) {
  const style = STATUS_BORDER[clip.approvalStatus] ?? { border: 'rgba(255,255,255,0.06)', bg: 'rgba(255,255,255,0.025)' };
  const label = STATUS_LABEL[clip.approvalStatus];

  return (
    <div
      className="rounded-2xl p-5 transition-all duration-200"
      style={{ border: `1px solid ${style.border}`, background: style.bg }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-white/40">
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
          className="text-[11px] bg-white/[0.04] border border-white/[0.08] text-white/70 rounded-lg px-2 py-1 outline-none focus:border-[#1AE7F6]/40"
        >
          <option value="">No day</option>
          {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>Day {d}</option>
          ))}
        </select>
      </div>

      <div className="text-white font-semibold mb-2 leading-snug">{clip.hook}</div>

      <div className="text-white/55 text-sm whitespace-pre-wrap mb-3 max-h-40 overflow-auto leading-relaxed">
        {clip.body}
      </div>

      {clip.cta && (
        <div className="text-white/40 text-xs italic mb-1">CTA: {clip.cta}</div>
      )}
      {clip.visualDirection && (
        <div className="text-white/30 text-xs">Visual: {clip.visualDirection}</div>
      )}

      {clip.driveFileUrl && (
        <a
          href={clip.driveFileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-xs underline mt-3 transition-colors"
          style={{ color: '#1AE7F6' }}
        >
          ▶ Open clip ↗
        </a>
      )}

      {clip.approvalStatus === 'pending' && (
        <div className="flex flex-wrap gap-2 mt-4">
          <button
            onClick={onApprove}
            className="px-4 py-1.5 text-xs font-semibold rounded-full transition-all duration-200 hover:scale-[1.03]"
            style={{ background: 'rgba(16,185,129,0.18)', color: 'rgb(110,231,183)', border: '1px solid rgba(16,185,129,0.35)' }}
          >
            Approve ✓
          </button>
          <button
            onClick={onReject}
            className="px-4 py-1.5 text-xs font-medium rounded-full bg-white/[0.05] hover:bg-white/[0.10] border border-white/[0.08] text-white/70 hover:text-white transition-all duration-200"
          >
            Reject + ask for fix
          </button>
          <button
            onClick={onRegenerate}
            className="px-4 py-1.5 text-xs font-medium rounded-full transition-all duration-200 hover:scale-[1.03]"
            style={{ background: 'rgba(168,85,247,0.15)', color: 'rgb(216,180,254)', border: '1px solid rgba(168,85,247,0.30)' }}
          >
            ↻ Regenerate
          </button>
        </div>
      )}

      {clip.approvalStatus === 'regenerating' && (
        <div className="mt-3 text-xs flex items-center gap-2" style={{ color: 'rgb(216,180,254)' }}>
          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'rgb(216,180,254)' }} />
          Regenerating…
        </div>
      )}

      {clip.approvalStatus === 'rejected' && clip.approvalFeedback && (
        <div
          className="mt-3 text-xs px-3 py-2 rounded-lg"
          style={{ background: 'rgba(239,68,68,0.08)', color: 'rgb(252,165,165)' }}
        >
          Note: {clip.approvalFeedback}
        </div>
      )}
    </div>
  );
}
