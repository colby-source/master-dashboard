import { StepHeader, Panel, PrimaryBtn } from './_primitives';
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
      <div className="space-y-6">
        <StepHeader
          step="09 / Strategy"
          title="Strategy generated ✓"
          subtitle="Your 7-module launch package is ready. Review it on Drive, then upload your finalized assets."
        />
        {session.driveFolderUrl && (
          <a
            href={session.driveFolderUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-3 text-sm font-bold rounded-full transition-all duration-200 hover:scale-[1.02]"
            style={{
              background: 'linear-gradient(135deg, #1AE7F6 0%, #0A9396 100%)',
              boxShadow: '0 6px 20px rgba(10,147,150,0.28), 0 0 0 1px rgba(10,147,150,0.10)',
              color: '#06292B',
            }}
          >
            Open my brand folder →
          </a>
        )}
        <Panel>
          <details>
            <summary className="cursor-pointer text-slate-700 text-sm hover:text-slate-900 transition-colors">
              Inspect raw strategy JSON
            </summary>
            <pre className="mt-3 text-xs text-slate-600 overflow-auto max-h-96 font-mono bg-slate-50 rounded-lg p-3">
              {JSON.stringify(session.strategy, null, 2)}
            </pre>
          </details>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StepHeader
        step="09 / Generate"
        title="Generate your strategy"
        subtitle="Click the button. We'll build all 7 modules — master strategy, ICP psychology, authority positioning, content pillars, 30-day calendar, 50-hook bank, and monetization funnel. Takes about 3–4 minutes."
      />

      {!baseReady && (
        <Panel className="border-amber-300 bg-amber-50">
          <div className="text-sm font-semibold text-amber-800 mb-2">
            ⚠ {missing.length} required field{missing.length === 1 ? '' : 's'} missing
          </div>
          <ul className="space-y-1 text-sm text-slate-700">
            {missing.map((f) => (
              <li key={f} className="flex items-center gap-2">
                <span className="w-1 h-1 rounded-full bg-amber-500" />
                {f.replace(/_/g, ' ')}
              </li>
            ))}
          </ul>
          <div className="text-xs text-slate-500 mt-3">Step back through the wizard to complete these.</div>
        </Panel>
      )}

      {missingCompliance && (
        <Panel className="border-amber-300 bg-amber-50">
          <div className="text-sm text-amber-800">
            ⚠ Compliance acknowledgments required before strategy generation. Return to the Compliance step to complete the universal gates.
          </div>
        </Panel>
      )}

      {error && (
        <Panel className="border-rose-300 bg-rose-50">
          <div className="text-sm text-rose-700">{error}</div>
        </Panel>
      )}

      <PrimaryBtn onClick={onGenerate} disabled={!ready || generating}>
        {generating ? 'Generating… (3–4 min)' : 'Generate my 30-day launch package →'}
      </PrimaryBtn>
    </div>
  );
}
