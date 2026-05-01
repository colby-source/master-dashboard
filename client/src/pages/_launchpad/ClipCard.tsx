import type { ClipDto } from './_types';

interface Props {
  clip: ClipDto;
  onApprove: () => void;
  onReject: () => void;
  onReassign: (day: number | null) => void;
  onRegenerate: () => void;
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-900/40 text-amber-200 border-amber-900',
  approved: 'bg-emerald-900/40 text-emerald-200 border-emerald-900',
  rejected: 'bg-red-900/40 text-red-200 border-red-900',
  regenerating: 'bg-violet-900/40 text-violet-200 border-violet-900',
};

export function ClipCard({ clip, onApprove, onReject, onReassign, onRegenerate }: Props) {
  return (
    <div className={`border rounded p-4 ${STATUS_STYLES[clip.approvalStatus] || 'border-stone-800'}`}>
      <div className="flex items-start justify-between mb-2">
        <div className="text-[10px] uppercase tracking-wider text-stone-500">
          {clip.format} · pillar {clip.pillarNumber} · {clip.clipType.replace(/_/g, ' ')}
        </div>
        <select
          value={clip.assignedDay ?? ''}
          onChange={(e) => onReassign(e.target.value === '' ? null : parseInt(e.target.value))}
          className="text-[10px] bg-stone-900 border border-stone-800 text-stone-300 rounded px-1 py-0.5"
        >
          <option value="">No day</option>
          {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>Day {d}</option>)}
        </select>
      </div>
      <div className="text-stone-100 font-medium mb-2">{clip.hook}</div>
      <div className="text-stone-400 text-sm whitespace-pre-wrap mb-2 max-h-40 overflow-auto">
        {clip.body}
      </div>
      {clip.cta && <div className="text-stone-500 text-xs italic">CTA: {clip.cta}</div>}
      {clip.visualDirection && <div className="text-stone-600 text-xs mt-1">Visual: {clip.visualDirection}</div>}
      {clip.driveFileUrl && (
        <a href={clip.driveFileUrl} target="_blank" rel="noopener noreferrer"
           className="text-xs text-cyan-300 hover:text-cyan-200 underline block mt-2">
          ▶ Open clip ↗
        </a>
      )}
      {clip.approvalStatus === 'pending' && (
        <div className="flex flex-wrap gap-2 mt-3">
          <button onClick={onApprove} className="px-3 py-1 text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded">Approve</button>
          <button onClick={onReject} className="px-3 py-1 text-xs bg-stone-800 hover:bg-stone-700 text-stone-300 rounded">Reject + ask for fix</button>
          <button onClick={onRegenerate} className="px-3 py-1 text-xs bg-violet-800 hover:bg-violet-700 text-violet-100 rounded">↻ Regenerate</button>
        </div>
      )}
      {clip.approvalStatus === 'regenerating' && (
        <div className="mt-3 text-xs text-violet-300">Regenerating…</div>
      )}
      {clip.approvalStatus === 'rejected' && clip.approvalFeedback && (
        <div className="mt-2 text-xs text-red-300 bg-red-950/30 px-2 py-1 rounded">Note: {clip.approvalFeedback}</div>
      )}
    </div>
  );
}
