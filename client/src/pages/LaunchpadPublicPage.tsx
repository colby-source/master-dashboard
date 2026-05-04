import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { launchpadPublic } from '../lib/api/launchpad';

import { FullScreen } from './_launchpad/_primitives';
import { ProgressRail } from './_launchpad/ProgressRail';
import { StepWelcome } from './_launchpad/StepWelcome';
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
import { StepAssetsReview } from './_launchpad/StepAssetsReview';
import { StepBrandReview } from './_launchpad/StepBrandReview';
import { StepSubmit } from './_launchpad/StepSubmit';

import type { IntakeData, IntakePatch, Session } from './_launchpad/_types';

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

// Standard 12-step rail (brands WITHOUT admin pre-bake)
const STEPS_STANDARD = [
  { id: 'identity',    title: 'Brand basics' },
  { id: 'story',       title: 'Your story' },
  { id: 'audience',    title: 'Your audience' },
  { id: 'competition', title: 'Competition' },
  { id: 'products',    title: 'Products' },
  { id: 'compliance',  title: 'Compliance' },
  { id: 'channels',    title: 'Channels & goals' },
  { id: 'voice',       title: 'Voice & constraints' },
  { id: 'review',      title: 'Generate strategy' },
  { id: 'content',     title: 'Content studio' },
  { id: 'assets',      title: 'Upload assets' },
  { id: 'submit',      title: 'Submit for review' },
] as const;

// Condensed 6-step rail (brands WITH admin pre-bake)
// Brand direction is pre-built — creator reviews and approves rather than filling it in.
const STEPS_PREBAKED = [
  { id: 'brand_review',  title: 'Brand direction' },
  { id: 'products',      title: 'Products' },
  { id: 'compliance',    title: 'Compliance' },
  { id: 'content',       title: 'Content studio' },
  { id: 'assets_review', title: 'Brand assets' },
  { id: 'submit',        title: 'Submit for review' },
] as const;

type StandardStepId = typeof STEPS_STANDARD[number]['id'];
type PrebakedStepId = typeof STEPS_PREBAKED[number]['id'];
type RailStepId = StandardStepId | PrebakedStepId;
type StepId = RailStepId | 'welcome' | 'generating';

/** Returns true if the admin has pre-baked brand direction for this brand. */
function isPrebakedBrand(intake: IntakeData | null): boolean {
  return !!(intake as Record<string, unknown> | null)?.['admin_prep_sealed'];
}

export default function LaunchpadPublicPage() {
  const { token } = useParams<{ token: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<StepId>('welcome');
  const [intake, setIntake] = useState<IntakeData>({});
  const [savingState, setSavingState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const saveTimer = useRef<number | null>(null);

  // Derived: which step set we're using
  const prebaked = isPrebakedBrand(intake);
  const STEPS = prebaked ? STEPS_PREBAKED : STEPS_STANDARD;

  useEffect(() => {
    if (!token) return;
    launchpadPublic.getSession(token)
      .then((s) => {
        setSession(s);
        const loadedIntake = (s.intake as IntakeData) ?? {};
        if (s.intake) setIntake(loadedIntake);

        const isBaked = isPrebakedBrand(loadedIntake);

        // Route returning creators to the right step
        if (s.status === 'submitted' || s.status === 'in_review') {
          setStep('submit');
        } else if (isBaked) {
          // Pre-baked flow: skip welcome → go to brand_review (or content if strategy ready)
          if (s.status === 'strategy_generated' || s.status === 'assets_uploading') {
            setStep('assets_review');
          } else if (s.strategy) {
            setStep('content');
          } else {
            setStep('brand_review');
          }
        } else {
          // Standard flow
          if (s.status === 'strategy_generated' || s.status === 'assets_uploading') setStep('assets');
          else if (s.intake) setStep('review');
          else setStep('welcome');
        }
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [token]);

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

  useEffect(() => {
    if (!token || !generating) return;
    const interval = setInterval(() => {
      launchpadPublic.getSession(token).then((s) => {
        setSession(s);
        if (s.strategy) setGenerating(false);
      }).catch(() => { /* transient */ });
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

  if (loading) {
    return (
      <FullScreen>
        <div className="flex items-center gap-3 text-slate-500">
          <span className="w-2 h-2 rounded-full bg-[#0A9396] animate-pulse" />
          <span className="text-sm">Loading your portal…</span>
        </div>
      </FullScreen>
    );
  }

  if (error || !session) {
    return (
      <FullScreen>
        <div className="text-center space-y-3 max-w-sm">
          <div className="text-slate-300 text-4xl">⚡</div>
          <div className="text-slate-900 font-semibold">Link invalid or expired</div>
          <div className="text-slate-500 text-sm">Contact your launch manager for a fresh link.</div>
        </div>
      </FullScreen>
    );
  }

  // Off-rail welcome screen has no progress / nav chrome. Render full-bleed.
  if (step === 'welcome') {
    return (
      <div
        className="min-h-screen"
        style={{
          background:
            'radial-gradient(ellipse 80% 35% at 50% -5%, rgba(26,231,246,0.14) 0%, transparent 60%), #FAFAF7',
          color: '#0F172A',
        }}
      >
        <div className="max-w-3xl mx-auto px-6 py-12 sm:py-16">
          <StepWelcome
            brandName={session.brandName}
            onStart={() => setStep(prebaked ? 'brand_review' : 'identity')}
          />
        </div>
      </div>
    );
  }

  const stepIdx = STEPS.findIndex((s) => s.id === step);
  const missing = computeMissingIntakeFields(intake);
  const acks: Record<string, string> = (intake.compliance_acks as Record<string, string>) || {};
  const universalReady = ['no_disease_claims', 'ftc_disclosure', 'pre_publish_legal_review']
    .every((k) => !!acks[k]);

  // Gate: in pre-baked mode, "Submit" requires review signoffs + compliance + 30 approved clips
  const brandDirectionApproved = prebaked ? !!(intake.review_signoffs?.brand_direction) : true;
  const assetsApproved = prebaked ? !!(intake.review_signoffs?.assets) : true;

  return (
    <div
      className="min-h-screen"
      style={{
        background:
          'radial-gradient(ellipse 80% 35% at 50% -5%, rgba(26,231,246,0.10) 0%, transparent 60%), #FAFAF7',
        color: '#0F172A',
      }}
    >
      <div className="max-w-2xl mx-auto px-6 py-12">

        {/* ── Header ── */}
        <header className="mb-10">
          <div className="flex items-center gap-3 mb-6">
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest"
              style={{
                background: 'rgba(26,231,246,0.14)',
                border: '1px solid rgba(10,147,150,0.30)',
                color: '#016F74',
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ background: '#0A9396' }}
              />
              Brand Me Now
            </div>

            {/* Save indicator */}
            <div className="ml-auto text-[11px]">
              {savingState === 'saving' && (
                <span className="text-slate-500 flex items-center gap-1.5">
                  <span className="w-1 h-1 rounded-full bg-slate-400 animate-pulse" />
                  saving
                </span>
              )}
              {savingState === 'saved' && (
                <span className="text-slate-400">saved</span>
              )}
              {savingState === 'error' && (
                <span className="text-rose-600">save failed</span>
              )}
            </div>
          </div>

          <h1
            className="text-4xl font-bold tracking-tight text-slate-900"
            style={{ letterSpacing: '-0.02em' }}
          >
            {session.brandName}
          </h1>
          <p className="text-sm text-slate-500 mt-2">
            {session.launchDate
              ? `Launching ${new Date(session.launchDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`
              : prebaked ? 'Your launch package is being prepared.' : 'Set your launch date in the Channels step.'}
          </p>
        </header>

        <ProgressRail steps={STEPS as unknown as Array<{ id: string; title: string }>} current={stepIdx} />

        {/* ── Step content ── */}
        <main className="min-h-[420px]">

          {/* ── Standard (non-pre-baked) steps ── */}
          {step === 'identity'    && <StepIdentity intake={intake} update={update} />}
          {step === 'story'       && <StepStory intake={intake} update={update} />}
          {step === 'audience'    && <StepAudience intake={intake} update={update} updateNested={updateNested} />}
          {step === 'competition' && <StepCompetition intake={intake} update={update} />}
          {step === 'channels'    && <StepChannels intake={intake} update={update} />}
          {step === 'voice'       && <StepVoice intake={intake} update={update} />}
          {step === 'review'      && (
            <StepReview
              session={session}
              onGenerate={onGenerate}
              generating={generating}
              error={generationError}
              missing={missing}
              universalReady={universalReady}
            />
          )}
          {step === 'assets' && <StepAssets token={token!} session={session} />}

          {/* ── Pre-baked steps ── */}
          {step === 'brand_review' && (
            <StepBrandReview
              intake={intake}
              update={update}
              onApprove={() => setStep('products')}
            />
          )}
          {step === 'assets_review' && (
            <StepAssetsReview
              token={token!}
              intake={intake}
              update={update}
            />
          )}

          {/* ── Shared steps (both flows) ── */}
          {step === 'products'   && (
            <StepProducts
              token={token!}
              onComplete={() => setStep('compliance')}
            />
          )}
          {step === 'compliance' && (
            <StepCompliance
              token={token!}
              intake={intake}
              update={update}
              onComplete={() => setStep(prebaked ? 'content' : 'channels')}
            />
          )}
          {step === 'content' && (
            session.strategy
              ? <StepContent token={token!} />
              : <StepGenerating generating={generating} error={generationError} />
          )}
          {step === 'generating' && (
            <StepGenerating generating={generating} error={generationError} />
          )}
          {step === 'submit' && (
            <StepSubmit
              session={session}
              onSubmit={onSubmit}
              submitting={submitting}
              prebaked={prebaked}
              brandDirectionApproved={brandDirectionApproved}
              assetsApproved={assetsApproved}
              universalReady={universalReady}
            />
          )}
        </main>

        {/* ── Navigation ── */}
        <nav className="flex items-center justify-between mt-14 pt-6 border-t border-slate-200">
          <button
            type="button"
            disabled={stepIdx <= 0}
            onClick={() => {
              const prevIdx = Math.max(0, stepIdx - 1);
              setStep(STEPS[prevIdx].id as RailStepId);
            }}
            className="text-sm text-slate-500 hover:text-slate-900 disabled:opacity-0 transition-colors duration-200"
          >
            Back
          </button>
          <button
            type="button"
            disabled={stepIdx === STEPS.length - 1}
            onClick={() => {
              const nextIdx = Math.min(STEPS.length - 1, stepIdx + 1);
              setStep(STEPS[nextIdx].id as RailStepId);
            }}
            className="px-7 py-2.5 text-sm font-bold rounded-full disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
            style={
              stepIdx === STEPS.length - 1
                ? { background: '#CBD5E1', color: '#fff' }
                : {
                    background: 'linear-gradient(135deg, #1AE7F6 0%, #0A9396 100%)',
                    boxShadow: '0 6px 20px rgba(10,147,150,0.28), 0 0 0 1px rgba(10,147,150,0.10)',
                    color: '#06292B',
                  }
            }
          >
            Continue
          </button>
        </nav>

        {/* ── Footer ── */}
        <footer className="text-center mt-10 pb-6">
          {session.driveFolderUrl && (
            <a
              href={session.driveFolderUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-slate-400 hover:text-slate-700 underline transition-colors"
            >
              Open brand folder ↗
            </a>
          )}
        </footer>
      </div>
    </div>
  );
}
