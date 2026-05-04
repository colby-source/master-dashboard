import { useEffect, useState, useCallback } from 'react';
import { launchpadPublic } from '../../lib/api/launchpad';
import { ClipCard } from './ClipCard';
import { StepHeader, Panel, PrimaryBtn } from './_primitives';
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

  if (loading) {
    return (
      <div className="flex items-center gap-3 text-white/40">
        <span className="w-2 h-2 rounded-full bg-[#1AE7F6] animate-pulse" />
        <span className="text-sm">Loading content studio…</span>
      </div>
    );
  }

  const filtered = clips.filter((c) => filter === 'all' ? true : c.approvalStatus === filter);
  const counts = {
    all: clips.length,
    pending: clips.filter((c) => c.approvalStatus === 'pending').length,
    approved: clips.filter((c) => c.approvalStatus === 'approved').length,
    rejected: clips.filter((c) => c.approvalStatus === 'rejected').length,
  };

  return (
    <div className="space-y-6">
      <StepHeader
        step="10 / Content"
        title="Content studio"
        subtitle="We'll generate 5 long-form pieces (one per pillar) and chop them into ~40 short-form clips mapped to your 30-day calendar."
      />

      {clips.length === 0 ? (
        <Panel className="space-y-4">
          <div className="text-sm text-white/70">
            Click below to spin up your content engine. Takes about 4–6 minutes — you'll get long-form scripts AND ~40 ready-to-post clips back.
          </div>
          {error && <div className="text-sm text-red-300">{error}</div>}
          <PrimaryBtn onClick={onGenerate} disabled={generating}>
            {generating ? 'Generating… (4–6 min — keep this tab open)' : 'Generate my content engine →'}
          </PrimaryBtn>
        </Panel>
      ) : (
        <Panel className="flex items-center justify-between gap-3">
          <div className="text-sm text-white/70">
            <span className="font-semibold text-white">{sources.length}</span> long-form sources · <span className="font-semibold text-white">{clips.length}</span> clips ready to review
          </div>
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            className="px-4 py-2 text-xs font-medium bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.08] rounded-full text-white/70 hover:text-white transition-all duration-200 disabled:opacity-30 whitespace-nowrap"
          >
            {generating ? 'Generating…' : '+ Generate more'}
          </button>
        </Panel>
      )}

      {genResult && (
        <Panel className="text-xs text-white/50">
          {genResult.generatedSources} long-form generated · {genResult.choppedSources} chopped · {genResult.newClips} new clips
          {genResult.errors.length > 0 && <span className="text-amber-300 ml-2">· {genResult.errors.length} errors</span>}
        </Panel>
      )}

      <Panel className="space-y-3">
        <div>
          <div className="text-sm font-semibold text-white">Upload long-form video or audio</div>
          <p className="text-xs text-white/40 mt-1 leading-relaxed">
            Drop a podcast, interview, or talking-head clip. We'll transcribe it, identify highlight moments, and produce vertical 9:16 clips ready to post.
          </p>
        </div>
        <label
          className="inline-flex items-center gap-2 cursor-pointer px-5 py-2.5 text-sm font-bold text-[#0D0D0D] rounded-full transition-all duration-200 hover:scale-[1.02] w-fit"
          style={{
            background: 'linear-gradient(135deg, #1AE7F6 0%, #0A9396 100%)',
            boxShadow: '0 0 18px rgba(26,231,246,0.18)',
          }}
        >
          {uploadingVideo ? 'Uploading…' : '+ Upload video / audio'}
          <input type="file" accept="video/*,audio/*" className="hidden" onChange={onVideoUpload} disabled={uploadingVideo} />
        </label>
        {sources.filter((s) => s.sourceType === 'uploaded_video' || s.sourceType === 'uploaded_audio').map((s) => (
          <div key={s.id} className="flex items-center gap-2 text-xs text-white/50">
            <span className="text-white/30">[{s.sourceType.replace(/_/g, ' ')}]</span>
            <span>{s.title}</span>
            <span
              className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-medium"
              style={
                s.status === 'ready'
                  ? { background: 'rgba(16,185,129,0.12)', color: 'rgb(110,231,183)' }
                  : s.status === 'error'
                  ? { background: 'rgba(239,68,68,0.12)', color: 'rgb(252,165,165)' }
                  : { background: 'rgba(245,158,11,0.12)', color: 'rgb(252,211,77)' }
              }
            >
              {s.status === 'processing' || s.status === 'pending_processing' ? 'transcribing + chopping…' : s.status}
            </span>
          </div>
        ))}
      </Panel>

      {clips.filter((c) => c.approvalStatus === 'approved').length > 0 && (
        <Panel className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-white">Export approved schedule</div>
            <p className="text-xs text-white/40 mt-0.5">CSV with day-by-day hooks + captions, ready for Buffer / Later / Hootsuite.</p>
          </div>
          <a
            href={launchpadPublic.calendarCsvUrl(token)}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 text-xs font-medium bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.08] rounded-full text-white/70 hover:text-white transition-all duration-200 whitespace-nowrap"
          >
            Download CSV ↓
          </a>
        </Panel>
      )}

      {sources.length > 0 && (
        <Panel>
          <details>
            <summary className="cursor-pointer text-sm font-semibold text-white/70 hover:text-white transition-colors">
              Long-form sources ({sources.length})
            </summary>
            <div className="mt-3 space-y-1.5">
              {sources.map((s) => (
                <div key={s.id} className="text-xs text-white/50">
                  <span className="text-white/30">[Pillar {s.pillarNumber ?? '—'}]</span> {s.title}
                  <span className="text-white/25 ml-2">({s.sourceType.replace(/_/g, ' ')})</span>
                </div>
              ))}
            </div>
          </details>
        </Panel>
      )}

      {clips.length > 0 && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {(['all', 'pending', 'approved', 'rejected'] as const).map((f) => {
              const active = filter === f;
              return (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className="px-3.5 py-1.5 text-xs font-medium rounded-full transition-all duration-200"
                  style={
                    active
                      ? {
                          background: 'rgba(26,231,246,0.12)',
                          border: '1px solid rgba(26,231,246,0.4)',
                          color: '#1AE7F6',
                        }
                      : {
                          background: 'rgba(255,255,255,0.04)',
                          border: '1px solid rgba(255,255,255,0.08)',
                          color: 'rgba(255,255,255,0.6)',
                        }
                  }
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)} ({counts[f]})
                </button>
              );
            })}
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
