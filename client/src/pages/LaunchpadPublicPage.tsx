import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { launchpadPublic } from '../lib/api/launchpad';

import { FullScreen } from './_launchpad/_primitives';
import { ProgressRail } from './_launchpad/ProgressRail';
import { StepIdentity } from './_launchpad/StepIdentity';
import { StepStory } from './_launchpad/StepStory';
import { StepAudience } from './_launchpad/StepAudience';
import { StepCompetition } from './_launchpad/StepCompetition';
import { StepProducts } from './_launchpad/StepProducts';
import { StepCompliance } from './_launchpad/StepCompliance';
import { StepChannels } from './_launchpad/StepChannels';
import { StepVoice } from './_launchpad/StepVoice';
import { StepReview } from './_launchpad/StepReview';
import { StepGenerating } from './_launchpad/StepGenerating';
import { StepContent } from './_launchpad/StepContent';
import { StepAssets } from './_launchpad/StepAssets';
import { StepSubmit } from './_launchpad/StepSubmit';

import type { IntakeData, IntakePatch, Session } from './_launchpad/_types';

// Client-side mirror of server's launchpad-service.REQUIRED_INTAKE_FIELDS.
// Used so the "Generate strategy" gate updates as soon as the creator fills
// a field — without waiting for a session refetch round-trip.
const REQUIRED_INTAKE_FIELDS = [
  'brand_name', 'founder_name', 'niche', 'product_categories',
  'founder_story', 'signature_belief',
  'primary_icp', 'top_3_competitors', 'category_status',
  'primary_platform', 'posting_capacity',
  'launch_date', 'primary_goal', 'monetization_model', 'price_point_range',
  'brand_voice_dos', 'brand_voice_donts',
] as const satisfies readonly (keyof IntakeData)[];

function computeMissingIntakeFields(intake: IntakeData): string[] {
  return REQUIRED_INTAKE_FIELDS.filter((k) => {
    const v = intake[k];
    if (v === undefined || v === null) return true;
    if (typeof v === 'string') return v.trim().length === 0;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'object') return Object.keys(v).length === 0;
    return false;
  });
}

const STEPS = [
  { id: 'identity', title: 'Brand basics' },
  { id: 'story', title: 'Your story' },
  { id: 'audience', title: 'Your audience' },
  { id: 'competition', title: 'Competition' },
  { id: 'products', title: 'Products' },
  { id: 'compliance', title: 'Compliance' },
  { id: 'channels', title: 'Channels & goals' },
  { id: 'voice', title: 'Voice & constraints' },
  { id: 'review', title: 'Generate strategy' },
  { id: 'content', title: 'Content studio' },
  { id: 'assets', title: 'Upload assets' },
  { id: 'submit', title: 'Submit for review' },
] as const;

type StepId = typeof STEPS[number]['id'];

export default function LaunchpadPublicPage() {
  const { token } = useParams<{ token: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<StepId>('identity');
  const [intake, setIntake] = useState<IntakeData>({});
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const saveTimer = useRef<number | null>(null);

  // Initial session load
  useEffect(() => {
    if (!token) return;
    launchpadPublic.getSession(token)
      .then((s) => {
        setSession(s);
        if (s.intake) setIntake(s.intake as IntakeData);
        if (s.status === 'strategy_generated' || s.status === 'assets_uploading') setStep('assets');
        else if (s.status === 'submitted' || s.status === 'in_review') setStep('submit');
        else if (s.intake) setStep('review');
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [token]);

  // Auto-save intake (debounced 800ms)
  const saveIntake = useCallback((next: IntakeData) => {
    if (!token) return;
    setSavingState('saving');
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      launchpadPublic.saveIntake(token, next as unknown as Record<string, unknown>)
        .then(() => setSavingState('saved'))
        .catch(() => setSavingState('error'));
    }, 800);
  }, [token]);

  const update = useCallback((patch: IntakePatch) => {
    setIntake((prev) => {
      const next = { ...prev, ...patch };
      saveIntake(next);
      return next;
    });
  }, [saveIntake]);

  const updateNested = useCallback((path: string[], value: unknown) => {
    setIntake((prev) => {
      // The wizard's nested writes (e.g. ['primary_icp', 'demographic']) are
      // typed structurally on IntakeData but performed dynamically here. We
      // bridge through Record<string, unknown> for the dynamic walk and cast
      // back at the end.
      const next: Record<string, unknown> = { ...(prev as Record<string, unknown>) };
      let cur = next;
      for (let i = 0; i < path.length - 1; i++) {
        const seg = path[i];
        cur[seg] = { ...((cur[seg] as Record<string, unknown>) || {}) };
        cur = cur[seg] as Record<string, unknown>;
      }
      cur[path[path.length - 1]] = value;
      const nextIntake = next as unknown as IntakeData;
      saveIntake(nextIntake);
      return nextIntake;
    });
  }, [saveIntake]);

  // Strategy generation — fire-and-forget UX. Kicks off API, advances wizard
  // to Content step immediately. A polling effect refetches the session
  // until session.strategy lands, then transitions to the content studio.
  const onGenerate = () => {
    if (!token) return;
    setGenerating(true);
    setGenerationError(null);
    setStep('content');

    launchpadPublic.generateStrategy(token)
      .then(async (result) => {
        if (!result.ok) {
          setGenerationError('Strategy generation failed. Please contact your launch manager.');
        } else if (result.partial) {
          setGenerationError(`Strategy generated, but ${result.errors?.length} modules need a re-run. Your manager will fix.`);
        }
        const s = await launchpadPublic.getSession(token);
        setSession(s);
      })
      .catch((err) => setGenerationError(String(err)))
      .finally(() => setGenerating(false));
  };

  // Poll session every 8s while generating so Content step auto-transitions
  // when strategy lands.
  useEffect(() => {
    if (!token || !generating) return;
    const interval = setInterval(() => {
      launchpadPublic.getSession(token).then((s) => {
        setSession(s);
        if (s.strategy) setGenerating(false);
      }).catch(() => { /* transient errors are fine */ });
    }, 8000);
    return () => clearInterval(interval);
  }, [token, generating]);

  const onSubmit = async () => {
    if (!token) return;
    setSubmitting(true);
    try {
      await launchpadPublic.submit(token);
      const s = await launchpadPublic.getSession(token);
      setSession(s);
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <FullScreen><div className="text-stone-400">Loading…</div></FullScreen>;
  if (error || !session) return <FullScreen><div className="text-red-400">Link invalid or expired. Contact your launch manager.</div></FullScreen>;

  const stepIdx = STEPS.findIndex((s) => s.id === step);

  // Compute strategy-generation gate from LIVE intake state. Autosave is
  // debounced and the session response only reflects what the server saw at
  // page load — recomputing here keeps the button's enabled state honest.
  const missing = computeMissingIntakeFields(intake);
  const acks: Record<string, string> = (intake.compliance_acks as Record<string, string>) || {};
  const universalReady = ['no_disease_claims', 'ftc_disclosure', 'pre_publish_legal_review']
    .every((k) => !!acks[k]);

  return (
    <div className="min-h-screen bg-[#0D0D0D] text-stone-100">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <header className="mb-10">
          <div className="inline-block px-2.5 py-1 bg-cyan-400/20 text-cyan-300 text-[10px] font-semibold uppercase tracking-wider rounded mb-3">
            Brand Me Now — Launch Portal
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{session.brandName}</h1>
          <p className="text-stone-400 mt-1.5">
            {session.launchDate ? `Launching ${new Date(session.launchDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}` : 'Set your launch date below.'}
          </p>
        </header>

        <ProgressRail steps={STEPS} current={stepIdx} />

        <div className="text-xs text-stone-500 mb-4 h-4">
          {savingState === 'saving' && 'Saving…'}
          {savingState === 'saved' && 'All changes saved'}
          {savingState === 'error' && <span className="text-red-400">Save failed — check connection</span>}
        </div>

        <main className="space-y-6">
          {step === 'identity' && <StepIdentity intake={intake} update={update} />}
          {step === 'story' && <StepStory intake={intake} update={update} />}
          {step === 'audience' && <StepAudience intake={intake} update={update} updateNested={updateNested} />}
          {step === 'competition' && <StepCompetition intake={intake} update={update} />}
          {step === 'products' && <StepProducts token={token!} onComplete={() => setStep('compliance')} />}
          {step === 'compliance' && <StepCompliance token={token!} intake={intake} update={update} onComplete={() => setStep('channels')} />}
          {step === 'channels' && <StepChannels intake={intake} update={update} />}
          {step === 'voice' && <StepVoice intake={intake} update={update} />}
          {step === 'review' && (
            <StepReview
              session={session}
              onGenerate={onGenerate}
              generating={generating}
              error={generationError}
              missing={missing}
              universalReady={universalReady}
            />
          )}
          {step === 'content' && (
            session.strategy
              ? <StepContent token={token!} />
              : <StepGenerating generating={generating} error={generationError} />
          )}
          {step === 'assets' && session.strategy && <StepAssets token={token!} session={session} />}
          {step === 'submit' && <StepSubmit session={session} onSubmit={onSubmit} submitting={submitting} />}
        </main>

        <nav className="flex justify-between mt-12 pt-6 border-t border-stone-800">
          <button
            type="button"
            disabled={stepIdx === 0}
            onClick={() => setStep(STEPS[Math.max(0, stepIdx - 1)].id)}
            className="px-4 py-2 text-sm text-stone-400 hover:text-stone-200 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ← Back
          </button>
          <button
            type="button"
            disabled={stepIdx === STEPS.length - 1}
            onClick={() => setStep(STEPS[Math.min(STEPS.length - 1, stepIdx + 1)].id)}
            className="px-5 py-2 text-sm font-medium bg-teal-700 hover:bg-teal-600 text-white rounded disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Continue →
          </button>
        </nav>

        <footer className="text-center text-xs text-stone-600 mt-10 pb-6">
          Brand Me Now · {session.driveFolderUrl && <a href={session.driveFolderUrl} target="_blank" rel="noopener noreferrer" className="underline">your brand folder</a>}
        </footer>
      </div>
    </div>
  );
}
