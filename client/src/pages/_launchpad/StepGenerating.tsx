interface Props {
  generating: boolean;
  error: string | null;
}

export function StepGenerating({ generating, error }: Props) {
  return (
    <div className="space-y-5">
      <h2 className="text-2xl font-semibold">Generating your strategy</h2>
      <p className="text-stone-400">
        Building all 7 modules — master strategy, ICP psychology, authority positioning, content pillars,
        30-day calendar, 50-hook bank, and monetization funnel. This usually takes 3-4 minutes.
      </p>

      <div className="border border-stone-800 rounded p-5 bg-stone-950 space-y-3">
        {generating ? (
          <>
            <div className="flex items-center gap-3">
              <div className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
              <div className="text-sm text-stone-200 font-medium">Working…</div>
            </div>
            <p className="text-xs text-stone-500">
              You can leave this tab open or close it — we'll keep generating in the background.
              When you come back, your content studio will be ready.
            </p>
          </>
        ) : error ? (
          <div className="text-sm text-red-400">{error}</div>
        ) : (
          <div className="text-sm text-stone-300">
            Strategy isn't ready yet. Refreshing in a few seconds…
          </div>
        )}
      </div>

      {error && !generating && (
        <p className="text-xs text-stone-500">
          If this persists, contact your launch manager — they can re-run the modules manually.
        </p>
      )}
    </div>
  );
}
