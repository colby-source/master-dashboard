import type { Session } from './_types';

interface Props {
  session: Session;
  onGenerate: () => void;
  generating: boolean;
  error: string | null;
  missing: string[];
  universalReady: boolean;
}

export function StepReview({ session, onGenerate, generating, error, missing, universalReady }: Props) {
  const baseReady = missing.length === 0;
  const ready = baseReady && universalReady;
  const missingCompliance = baseReady && !universalReady;

  if (session.strategy) {
    return (
      <div className="space-y-5">
        <h2 className="text-2xl font-semibold">Strategy generated ✓</h2>
        <p className="text-stone-400">Your 7-module launch package is ready. Review it on Google Drive, then move on to upload your finalized assets.</p>
        {session.driveFolderUrl && (
          <a href={session.driveFolderUrl} target="_blank" rel="noopener noreferrer" className="inline-block px-4 py-2 bg-teal-700 hover:bg-teal-600 text-white text-sm rounded">
            Open my brand folder →
          </a>
        )}
        <details className="border border-stone-800 rounded p-4 bg-stone-950">
          <summary className="cursor-pointer text-stone-300 text-sm">Inspect raw strategy JSON</summary>
          <pre className="mt-3 text-xs text-stone-400 overflow-auto max-h-96">{JSON.stringify(session.strategy, null, 2)}</pre>
        </details>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h2 className="text-2xl font-semibold">Generate your strategy</h2>
      <p className="text-stone-400">When you click below, I'll generate all 7 modules — master strategy, ICP psychology, authority positioning, content pillars, 30-day calendar, 50-hook bank, and monetization funnel. Takes about 3-4 minutes.</p>
      {!baseReady && (
        <div className="text-sm text-amber-300">
          <div className="font-medium">⚠ {missing.length} required field{missing.length === 1 ? '' : 's'} missing:</div>
          <ul className="list-disc list-inside mt-1.5 space-y-0.5 text-stone-300">
            {missing.map((f) => (
              <li key={f}>{f.replace(/_/g, ' ')}</li>
            ))}
          </ul>
          <div className="text-xs text-stone-500 mt-2">Step back through the wizard to complete these.</div>
        </div>
      )}
      {missingCompliance && (
        <div className="text-sm text-amber-300">
          ⚠ Compliance acknowledgments required before strategy generation. Return to the Compliance step to complete the universal gates.
        </div>
      )}
      {error && <div className="text-sm text-red-400">{error}</div>}
      <button
        type="button"
        onClick={onGenerate}
        disabled={!ready || generating}
        className="px-6 py-3 bg-cyan-500 hover:bg-cyan-400 text-stone-950 font-semibold rounded disabled:opacity-30 disabled:cursor-not-allowed"
      >
        {generating ? 'Generating… (3-4 min)' : 'Generate my 30-day launch package'}
      </button>
    </div>
  );
}
