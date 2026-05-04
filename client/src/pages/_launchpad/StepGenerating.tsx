import { StepHeader, Panel } from './_primitives';

interface Props {
  generating: boolean;
  error: string | null;
}

export function StepGenerating({ generating, error }: Props) {
  return (
    <div className="space-y-6">
      <StepHeader
        step="10 / Building"
        title="Generating your strategy"
        subtitle="Building all 7 modules — master strategy, ICP psychology, authority positioning, content pillars, 30-day calendar, 50-hook bank, monetization funnel. This usually takes 3–4 minutes."
      />

      <Panel>
        {generating ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: '#1AE7F6', boxShadow: '0 0 12px rgba(26,231,246,0.6)' }}
                />
                <div
                  className="absolute inset-0 h-2.5 w-2.5 rounded-full animate-ping"
                  style={{ background: '#1AE7F6' }}
                />
              </div>
              <div className="text-sm text-white font-semibold">Working on your launch package…</div>
            </div>
            <p className="text-xs text-white/40 leading-relaxed">
              Leave this tab open or close it — we'll keep generating in the background.
              When you come back, your content studio will be ready.
            </p>
          </div>
        ) : error ? (
          <div className="text-sm text-red-300">{error}</div>
        ) : (
          <div className="text-sm text-white/60">Strategy isn't ready yet. Refreshing in a few seconds…</div>
        )}
      </Panel>

      {error && !generating && (
        <p className="text-xs text-white/30">
          If this persists, contact your launch manager — they can re-run the modules manually.
        </p>
      )}
    </div>
  );
}
