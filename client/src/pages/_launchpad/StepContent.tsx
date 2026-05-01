import { useEffect, useState, useCallback } from 'react';
import { launchpadPublic } from '../../lib/api/launchpad';
import { ClipCard } from './ClipCard';
import type { ClipDto, SourceDto } from './_types';

interface GenResult {
  generatedSources: number;
  choppedSources: number;
  newClips: number;
  errors: unknown[];
}

type Filter = 'all' | 'pending' | 'approved' | 'rejected';

export function StepContent({ token }: { token: string }) {
  const [sources, setSources] = useState<SourceDto[]>([]);
  const [clips, setClips] = useState<ClipDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [genResult, setGenResult] = useState<GenResult | null>(null);
  const [uploadingVideo, setUploadingVideo] = useState(false);

  const refresh = useCallback(async () => {
    const [src, cl] = await Promise.all([launchpadPublic.listSources(token), launchpadPublic.listClips(token)]);
    setSources(src.sources as SourceDto[]);
    setClips(cl.clips as ClipDto[]);
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      Promise.all([launchpadPublic.listSources(token), launchpadPublic.listClips(token)])
        .then(([src, cl]) => {
          if (cancelled) return;
          setSources(src.sources as SourceDto[]);
          setClips(cl.clips as ClipDto[]);
        })
        .finally(() => { if (!cancelled) setLoading(false); });
    };
    tick();
    // Auto-refresh while any source is processing (video transcription can take minutes)
    const interval = setInterval(() => {
      if (sources.some((s) => s.status === 'processing' || s.status === 'pending_processing')) tick();
    }, 8000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [token, sources]);

  const onGenerate = async () => {
    setGenerating(true);
    setError(null);
    setGenResult(null);
    try {
      const r = await launchpadPublic.generateContent(token, { generateLongform: true, chopExistingSources: true, autoMapToCalendar: true });
      setGenResult(r as GenResult);
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setGenerating(false);
    }
  };

  const approve = async (clipId: string) => { await launchpadPublic.approveClip(token, clipId); refresh(); };
  const reject = async (clipId: string) => {
    const feedback = prompt('What needs to change?') || '';
    await launchpadPublic.rejectClip(token, clipId, feedback); refresh();
  };
  const reassign = async (clipId: string, day: number | null) => { await launchpadPublic.reassignClipDay(token, clipId, day); refresh(); };
  const regenerate = async (clipId: string) => { await launchpadPublic.regenerateClip(token, clipId); refresh(); };

  const onVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingVideo(true);
    setError(null);
    try {
      await launchpadPublic.uploadVideo(token, file, { title: file.name });
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setUploadingVideo(false);
      e.target.value = '';
    }
  };

  if (loading) return <div className="text-stone-400">Loading content studio…</div>;

  const filtered = clips.filter((c) => filter === 'all' ? true : c.approvalStatus === filter);
  const counts = {
    all: clips.length,
    pending: clips.filter((c) => c.approvalStatus === 'pending').length,
    approved: clips.filter((c) => c.approvalStatus === 'approved').length,
    rejected: clips.filter((c) => c.approvalStatus === 'rejected').length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Content studio</h2>
        <p className="text-stone-400 mt-1">We'll generate 5 long-form pieces (one per pillar) and chop them into ~40 short-form clips mapped to your 30-day calendar.</p>
      </div>

      {clips.length === 0 ? (
        <div className="border border-stone-800 rounded p-6 bg-stone-950 space-y-4">
          <div className="text-sm text-stone-300">
            Click below to spin up your content engine. Takes about 4-6 minutes — you'll get long-form scripts AND ~40 ready-to-post clips back.
          </div>
          {error && <div className="text-sm text-red-400">{error}</div>}
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            className="px-6 py-3 bg-cyan-500 hover:bg-cyan-400 text-stone-950 font-semibold rounded disabled:opacity-30"
          >
            {generating ? 'Generating… (4-6 min — keep this tab open)' : 'Generate my content engine'}
          </button>
        </div>
      ) : (
        <div className="border border-stone-800 rounded p-4 bg-stone-950 flex items-center justify-between">
          <div className="text-sm text-stone-300">
            <span className="font-medium">{sources.length}</span> long-form sources · <span className="font-medium">{clips.length}</span> clips ready to review
          </div>
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            className="px-4 py-2 text-xs bg-stone-800 hover:bg-stone-700 rounded disabled:opacity-30"
          >
            {generating ? 'Generating…' : '+ Generate more'}
          </button>
        </div>
      )}

      {genResult && (
        <div className="text-xs text-stone-400 bg-stone-900 border border-stone-800 rounded p-3">
          {genResult.generatedSources} long-form generated · {genResult.choppedSources} chopped · {genResult.newClips} new clips
          {genResult.errors.length > 0 && <span className="text-amber-300 ml-2">· {genResult.errors.length} errors</span>}
        </div>
      )}

      <div className="border border-stone-800 rounded p-4 space-y-2">
        <div className="text-sm font-medium text-stone-200">Upload long-form video or audio (we chop it for you)</div>
        <p className="text-xs text-stone-500">Drop a podcast, interview, or talking-head clip. We'll transcribe it, identify highlight moments, and produce vertical 9:16 clips ready to post.</p>
        <label className="inline-block cursor-pointer px-4 py-2 text-sm bg-cyan-700 hover:bg-cyan-600 text-white rounded">
          {uploadingVideo ? 'Uploading…' : '+ Upload video / audio'}
          <input type="file" accept="video/*,audio/*" className="hidden" onChange={onVideoUpload} disabled={uploadingVideo} />
        </label>
        {sources.filter((s) => s.sourceType === 'uploaded_video' || s.sourceType === 'uploaded_audio').map((s) => (
          <div key={s.id} className="text-xs text-stone-400 mt-1">
            <span className="text-stone-500">[{s.sourceType.replace(/_/g, ' ')}]</span> {s.title}
            <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] ${
              s.status === 'ready' ? 'bg-emerald-900 text-emerald-200' :
              s.status === 'error' ? 'bg-red-900 text-red-200' :
              'bg-amber-900 text-amber-200'
            }`}>
              {s.status === 'processing' || s.status === 'pending_processing' ? 'transcribing + chopping…' : s.status}
            </span>
          </div>
        ))}
      </div>

      {clips.filter((c) => c.approvalStatus === 'approved').length > 0 && (
        <div className="border border-stone-800 rounded p-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-stone-200">Export approved schedule</div>
            <p className="text-xs text-stone-500">CSV with day-by-day hooks + captions, ready to import into Buffer / Later / Hootsuite.</p>
          </div>
          <a href={launchpadPublic.calendarCsvUrl(token)} target="_blank" rel="noopener noreferrer"
             className="px-4 py-2 text-sm bg-stone-800 hover:bg-stone-700 text-stone-200 rounded">
            Download CSV ↓
          </a>
        </div>
      )}

      {sources.length > 0 && (
        <details className="border border-stone-800 rounded p-4">
          <summary className="cursor-pointer text-sm font-medium">Long-form sources ({sources.length})</summary>
          <div className="mt-3 space-y-1">
            {sources.map((s) => (
              <div key={s.id} className="text-xs text-stone-400">
                <span className="text-stone-500">[Pillar {s.pillarNumber ?? '—'}]</span> {s.title}
                <span className="text-stone-600 ml-2">({s.sourceType.replace(/_/g, ' ')})</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {clips.length > 0 && (
        <div className="space-y-4">
          <div className="flex gap-2 text-xs">
            {(['all', 'pending', 'approved', 'rejected'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded ${filter === f ? 'bg-cyan-700 text-white' : 'bg-stone-800 hover:bg-stone-700 text-stone-300'}`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {filtered.map((c) => (
              <ClipCard
                key={c.id}
                clip={c}
                onApprove={() => approve(c.id)}
                onReject={() => reject(c.id)}
                onReassign={(day) => reassign(c.id, day)}
                onRegenerate={() => regenerate(c.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
