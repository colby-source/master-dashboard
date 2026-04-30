import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { launchpadPublic } from '../lib/api/launchpad';
import { StepProducts } from './_launchpad/StepProducts';
import { StepCompliance } from './_launchpad/StepCompliance';

type IntakeData = Record<string, any>;
type Session = Awaited<ReturnType<typeof launchpadPublic.getSession>>;

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
] as const;

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

  // ── Initial session load ─────────────────────────────────
  useEffect(() => {
    if (!token) return;
    launchpadPublic.getSession(token)
      .then((s) => {
        setSession(s);
        if (s.intake) setIntake(s.intake);
        // Skip to a later step if there's progress
        if (s.status === 'strategy_generated' || s.status === 'assets_uploading') setStep('assets');
        else if (s.status === 'submitted' || s.status === 'in_review') setStep('submit');
        else if (s.intake) setStep('review');
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [token]);

  // ── Auto-save intake (debounced 800ms) ──────────────────
  const saveIntake = useCallback(
    (next: IntakeData) => {
      if (!token) return;
      setSavingState('saving');
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        launchpadPublic.saveIntake(token, next)
          .then(() => setSavingState('saved'))
          .catch(() => setSavingState('error'));
      }, 800);
    },
    [token],
  );

  const update = useCallback((patch: Partial<IntakeData>) => {
    setIntake((prev) => {
      const next = { ...prev, ...patch };
      saveIntake(next);
      return next;
    });
  }, [saveIntake]);

  const updateNested = useCallback((path: string[], value: any) => {
    setIntake((prev) => {
      const next: IntakeData = { ...prev };
      let cur: any = next;
      for (let i = 0; i < path.length - 1; i++) {
        cur[path[i]] = { ...(cur[path[i]] || {}) };
        cur = cur[path[i]];
      }
      cur[path[path.length - 1]] = value;
      saveIntake(next);
      return next;
    });
  }, [saveIntake]);

  // ── Strategy generation ─────────────────────────────────
  // Fire-and-forget UX: kick off generation, advance the wizard
  // immediately to the Content step. The Content step polls the session
  // and renders a "generating…" placeholder until session.strategy
  // appears, then transitions to the normal content studio. Creators
  // never get stuck on a 3-4-min spinner.
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

  // Poll the session every 8s while strategy is generating so the Content
  // step can show progress + auto-transition when the strategy lands.
  useEffect(() => {
    if (!token || !generating) return;
    const interval = setInterval(() => {
      launchpadPublic.getSession(token).then((s) => {
        setSession(s);
        if (s.strategy) {
          setGenerating(false);
        }
      }).catch(() => { /* transient errors are fine */ });
    }, 8000);
    return () => clearInterval(interval);
  }, [token, generating]);

  // ── Submit ─────────────────────────────────────────────
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

  return (
    <div className="min-h-screen bg-[#0D0D0D] text-stone-100">
      <div className="max-w-3xl mx-auto px-6 py-10">
        {/* Header */}
        <header className="mb-10">
          <div className="inline-block px-2.5 py-1 bg-cyan-400/20 text-cyan-300 text-[10px] font-semibold uppercase tracking-wider rounded mb-3">
            Brand Me Now — Launch Portal
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{session.brandName}</h1>
          <p className="text-stone-400 mt-1.5">
            {session.launchDate ? `Launching ${new Date(session.launchDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}` : 'Set your launch date below.'}
          </p>
        </header>

        {/* Progress rail */}
        <ProgressRail steps={STEPS} current={stepIdx} />

        {/* Save indicator */}
        <div className="text-xs text-stone-500 mb-4 h-4">
          {savingState === 'saving' && 'Saving…'}
          {savingState === 'saved' && 'All changes saved'}
          {savingState === 'error' && <span className="text-red-400">Save failed — check connection</span>}
        </div>

        {/* Step content */}
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
              intake={intake}
              session={session}
              onGenerate={onGenerate}
              generating={generating}
              error={generationError}
            />
          )}
          {step === 'content' && (
            session.strategy
              ? <StepContent token={token!} />
              : <StepGenerating generating={generating} error={generationError} />
          )}
          {step === 'assets' && session.strategy && <StepAssets token={token!} session={session} />}
          {step === 'submit' && (
            <StepSubmit session={session} onSubmit={onSubmit} submitting={submitting} />
          )}
        </main>

        {/* Nav */}
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

// ── Layout helpers ─────────────────────────────────────────

function FullScreen({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-[#0D0D0D] flex items-center justify-center px-6">{children}</div>;
}

function ProgressRail({ steps, current }: { steps: readonly { id: string; title: string }[]; current: number }) {
  return (
    <div className="flex items-center gap-1 mb-8">
      {steps.map((s, i) => (
        <div key={s.id} className="flex-1 flex flex-col gap-1">
          <div className={`h-1 rounded-full ${i <= current ? 'bg-cyan-400' : 'bg-stone-800'}`} />
          <div className={`text-[10px] uppercase tracking-wider ${i === current ? 'text-cyan-300' : 'text-stone-600'}`}>
            {s.title}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Form primitives ────────────────────────────────────────

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-sm font-medium text-stone-200 mb-1.5">{label}</div>
      {hint && <div className="text-xs text-stone-500 mb-2">{hint}</div>}
      {children}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full bg-stone-900 border border-stone-800 focus:border-cyan-500 rounded px-3 py-2.5 text-stone-100 placeholder-stone-600 outline-none transition ${props.className || ''}`}
    />
  );
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`w-full bg-stone-900 border border-stone-800 focus:border-cyan-500 rounded px-3 py-2.5 text-stone-100 placeholder-stone-600 outline-none transition ${props.className || ''}`}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full bg-stone-900 border border-stone-800 focus:border-cyan-500 rounded px-3 py-2.5 text-stone-100 outline-none transition ${props.className || ''}`}
    />
  );
}

function Chips({ values, onChange, placeholder }: { values: string[]; onChange: (next: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState('');
  const add = () => {
    const v = input.trim();
    if (!v) return;
    onChange([...values, v]);
    setInput('');
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {values.map((v, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-teal-900/50 border border-teal-800 text-teal-200 text-xs rounded">
            {v}
            <button type="button" onClick={() => onChange(values.filter((_, j) => j !== i))} className="hover:text-white">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={placeholder || 'Type and press Enter'} />
        <button type="button" onClick={add} className="px-3 py-2 text-sm bg-stone-800 hover:bg-stone-700 text-stone-200 rounded">Add</button>
      </div>
    </div>
  );
}

// ── Steps ──────────────────────────────────────────────────

function StepIdentity({ intake, update }: { intake: IntakeData; update: (p: any) => void }) {
  return (
    <div className="space-y-5">
      <h2 className="text-2xl font-semibold">Brand basics</h2>
      <Field label="Brand name" hint="The official name (not the LLC)">
        <Input value={intake.brand_name || ''} onChange={(e) => update({ brand_name: e.target.value })} />
      </Field>
      <Field label="Founder name">
        <Input value={intake.founder_name || ''} onChange={(e) => update({ founder_name: e.target.value })} />
      </Field>
      <Field label="Primary handle (Instagram or TikTok)" hint="Optional — we'll cross-link your bio">
        <Input value={intake.founder_handle || ''} onChange={(e) => update({ founder_handle: e.target.value })} placeholder="@yourbrand" />
      </Field>
      <Field label="Niche" hint="One sentence — be specific. 'Clean skincare for postpartum moms' beats 'skincare'.">
        <Input value={intake.niche || ''} onChange={(e) => update({ niche: e.target.value })} />
      </Field>
      <Field label="Product categories" hint="Press Enter after each one">
        <Chips values={intake.product_categories || []} onChange={(v) => update({ product_categories: v })} placeholder="serum, cleanser, supplement…" />
      </Field>
    </div>
  );
}

function StepStory({ intake, update }: { intake: IntakeData; update: (p: any) => void }) {
  return (
    <div className="space-y-5">
      <h2 className="text-2xl font-semibold">Your story</h2>
      <Field label="Why this brand?" hint="What did you see broken in the category that nobody else is fixing? 2-3 sentences.">
        <Textarea rows={4} value={intake.founder_story || ''} onChange={(e) => update({ founder_story: e.target.value })} />
      </Field>
      <Field label="Origin moment" hint="Was there a specific moment that made this brand inevitable? (Optional but powerful.)">
        <Textarea rows={3} value={intake.origin_moment || ''} onChange={(e) => update({ origin_moment: e.target.value })} />
      </Field>
      <Field label="Your signature belief" hint="The one thing you say that nobody else in your category says out loud. This is the spine of every post we'll write.">
        <Textarea rows={3} value={intake.signature_belief || ''} onChange={(e) => update({ signature_belief: e.target.value })} />
      </Field>
    </div>
  );
}

function StepAudience({ intake, updateNested }: { intake: IntakeData; update: (p: any) => void; updateNested: (path: string[], v: any) => void }) {
  const icp = intake.primary_icp || {};
  return (
    <div className="space-y-5">
      <h2 className="text-2xl font-semibold">Your audience</h2>
      <Field label="Demographic" hint="Age range, gender, income range, location">
        <Input value={icp.demographic || ''} onChange={(e) => updateNested(['primary_icp', 'demographic'], e.target.value)} placeholder="Women 28-42, $80K+ HHI, US suburbs" />
      </Field>
      <Field label="Psychographic" hint="What they value, who they aspire to be">
        <Textarea rows={3} value={icp.psychographic || ''} onChange={(e) => updateNested(['primary_icp', 'psychographic'], e.target.value)} />
      </Field>
      <Field label="Where they hang out" hint="Subreddits, hashtags, podcasts, accounts they follow. Press Enter after each.">
        <Chips values={icp.where_they_hang_out || []} onChange={(v) => updateNested(['primary_icp', 'where_they_hang_out'], v)} placeholder="r/SkincareAddiction, #cleanbeauty…" />
      </Field>
    </div>
  );
}

function StepCompetition({ intake, update }: { intake: IntakeData; update: (p: any) => void }) {
  const competitors = (intake.top_3_competitors || []) as Array<{ name?: string; handle?: string; what_we_do_differently?: string }>;
  const updateCompetitor = (i: number, patch: any) => {
    const next = competitors.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
    while (next.length < 3) next.push({});
    update({ top_3_competitors: next });
  };
  return (
    <div className="space-y-5">
      <h2 className="text-2xl font-semibold">Competition</h2>
      <p className="text-sm text-stone-400">Name 3 brands customers compare you to. For each, tell me what you do meaningfully differently — not "better quality", be specific.</p>
      {[0, 1, 2].map((i) => (
        <div key={i} className="border border-stone-800 rounded p-4 space-y-3">
          <div className="text-xs uppercase tracking-wider text-stone-500">Competitor {i + 1}</div>
          <Input placeholder="Brand name" value={competitors[i]?.name || ''} onChange={(e) => updateCompetitor(i, { name: e.target.value })} />
          <Input placeholder="@handle (optional)" value={competitors[i]?.handle || ''} onChange={(e) => updateCompetitor(i, { handle: e.target.value })} />
          <Textarea rows={2} placeholder="What do you do differently?" value={competitors[i]?.what_we_do_differently || ''} onChange={(e) => updateCompetitor(i, { what_we_do_differently: e.target.value })} />
        </div>
      ))}
      <Field label="Your category status">
        <Select value={intake.category_status || ''} onChange={(e) => update({ category_status: e.target.value })}>
          <option value="">Select…</option>
          <option value="new">New — I'm creating this category</option>
          <option value="emerging">Emerging — early adopters are finding it</option>
          <option value="crowded">Crowded — I'm displacing incumbents</option>
          <option value="declining">Declining — incumbents losing trust</option>
        </Select>
      </Field>
    </div>
  );
}

function StepChannels({ intake, update }: { intake: IntakeData; update: (p: any) => void }) {
  return (
    <div className="space-y-5">
      <h2 className="text-2xl font-semibold">Channels & goals</h2>
      <Field label="Primary platform" hint="Where the founder will spend the most energy">
        <Select value={intake.primary_platform || ''} onChange={(e) => update({ primary_platform: e.target.value })}>
          <option value="">Select…</option>
          <option value="instagram">Instagram</option>
          <option value="tiktok">TikTok</option>
          <option value="youtube">YouTube</option>
          <option value="linkedin">LinkedIn</option>
          <option value="twitter">Twitter / X</option>
        </Select>
      </Field>
      <Field label="Secondary platforms (cross-post / repurpose)">
        <Chips values={intake.secondary_platforms || []} onChange={(v) => update({ secondary_platforms: v })} placeholder="instagram, tiktok…" />
      </Field>
      <Field label="Posting capacity">
        <Select value={intake.posting_capacity || ''} onChange={(e) => update({ posting_capacity: e.target.value })}>
          <option value="">Select…</option>
          <option value="daily">Daily (30 posts in 30 days)</option>
          <option value="every_other_day">Every other day (~15 posts)</option>
          <option value="3x_week">3x per week (~13 posts)</option>
        </Select>
      </Field>
      <Field label="Launch date" hint="When does the first post go live?">
        <Input type="date" value={intake.launch_date || ''} onChange={(e) => update({ launch_date: e.target.value })} />
      </Field>
      <Field label="Primary goal of the first 30 days">
        <Select value={intake.primary_goal || ''} onChange={(e) => update({ primary_goal: e.target.value })}>
          <option value="">Select…</option>
          <option value="awareness">Awareness — reach + brand recognition</option>
          <option value="list_build">List build — capture emails/SMS</option>
          <option value="sales">Sales — direct DTC purchases</option>
          <option value="community">Community — deep engagement</option>
        </Select>
      </Field>
      <Field label="Monetization model" hint="Pick all that apply">
        <Chips values={intake.monetization_model || []} onChange={(v) => update({ monetization_model: v })} placeholder="dtc, affiliate, live_selling, wholesale, membership" />
      </Field>
      <Field label="Price point range" hint='e.g. "$28 cleanser to $65 serum"'>
        <Input value={intake.price_point_range || ''} onChange={(e) => update({ price_point_range: e.target.value })} />
      </Field>
    </div>
  );
}

function StepVoice({ intake, update }: { intake: IntakeData; update: (p: any) => void }) {
  return (
    <div className="space-y-5">
      <h2 className="text-2xl font-semibold">Voice & constraints</h2>
      <Field label="What 5 words describe how this brand TALKS?" hint="e.g. honest, dry, science-y, warm, irreverent">
        <Chips values={intake.brand_voice_dos || []} onChange={(v) => update({ brand_voice_dos: v })} />
      </Field>
      <Field label="What does this brand NEVER sound like?" hint="Phrases or styles to avoid">
        <Chips values={intake.brand_voice_donts || []} onChange={(v) => update({ brand_voice_donts: v })} />
      </Field>
      <Field label="Off-limits topics">
        <Chips values={intake.off_limits_topics || []} onChange={(v) => update({ off_limits_topics: v })} placeholder="politics, weight-loss claims…" />
      </Field>
      <Field label="Visual style notes" hint="clean / maximalist / earthy / clinical — or a reference brand">
        <Textarea rows={2} value={intake.visual_style_notes || ''} onChange={(e) => update({ visual_style_notes: e.target.value })} />
      </Field>
      <Field label="Legal constraints" hint="FDA structure/function for supplements, state-by-state for cannabis, etc.">
        <Chips values={intake.legal_constraints || []} onChange={(v) => update({ legal_constraints: v })} />
      </Field>
    </div>
  );
}

function StepReview({ intake, session, onGenerate, generating, error }: {
  intake: IntakeData;
  session: Session;
  onGenerate: () => void;
  generating: boolean;
  error: string | null;
}) {
  // Compute missing fields from LIVE intake state — autosave is debounced
  // and the session response only reflects what the server saw at page load.
  // This way the gate updates immediately as the creator fills in each field.
  const missing = computeMissingIntakeFields(intake);
  const baseReady = missing.length === 0;
  const acks: Record<string, string> = intake.compliance_acks || {};
  const universalReady = ['no_disease_claims', 'ftc_disclosure', 'pre_publish_legal_review']
    .every((k) => !!acks[k]);
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
      {baseReady && missingCompliance && (
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

function StepGenerating({ generating, error }: { generating: boolean; error: string | null }) {
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

function StepContent({ token }: { token: string }) {
  const [sources, setSources] = useState<Array<{ id: string; sourceType: string; pillarNumber: number | null; title: string; status: string }>>([]);
  const [clips, setClips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [genResult, setGenResult] = useState<{ generatedSources: number; choppedSources: number; newClips: number; errors: any[] } | null>(null);
  const [uploadingVideo, setUploadingVideo] = useState(false);

  const refresh = useCallback(async () => {
    const [src, cl] = await Promise.all([launchpadPublic.listSources(token), launchpadPublic.listClips(token)]);
    setSources(src.sources);
    setClips(cl.clips);
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      Promise.all([launchpadPublic.listSources(token), launchpadPublic.listClips(token)])
        .then(([src, cl]) => {
          if (!cancelled) { setSources(src.sources); setClips(cl.clips); }
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
      setGenResult(r);
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setGenerating(false);
    }
  };

  const approve = async (clipId: string) => {
    await launchpadPublic.approveClip(token, clipId);
    refresh();
  };
  const reject = async (clipId: string) => {
    const feedback = prompt('What needs to change?') || '';
    await launchpadPublic.rejectClip(token, clipId, feedback);
    refresh();
  };
  const reassign = async (clipId: string, day: number | null) => {
    await launchpadPublic.reassignClipDay(token, clipId, day);
    refresh();
  };
  const regenerate = async (clipId: string) => {
    await launchpadPublic.regenerateClip(token, clipId);
    refresh();
  };

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

      {/* Generate panel */}
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

      {/* Video upload — chops uploaded video into clips */}
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

      {/* CSV export shortcut */}
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

      {/* Long-form sources */}
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

      {/* Clips review */}
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

function ClipCard({ clip, onApprove, onReject, onReassign, onRegenerate }: { clip: any; onApprove: () => void; onReject: () => void; onReassign: (day: number | null) => void; onRegenerate: () => void }) {
  const statusColor: Record<string, string> = {
    pending: 'bg-amber-900/40 text-amber-200 border-amber-900',
    approved: 'bg-emerald-900/40 text-emerald-200 border-emerald-900',
    rejected: 'bg-red-900/40 text-red-200 border-red-900',
    regenerating: 'bg-violet-900/40 text-violet-200 border-violet-900',
  };
  return (
    <div className={`border rounded p-4 ${statusColor[clip.approvalStatus] || 'border-stone-800'}`}>
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

function StepAssets({ token, session }: { token: string; session: Session }) {
  const [assets, setAssets] = useState<Array<{ id: string; asset_type: string; filename: string; drive_file_url: string }>>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    launchpadPublic.listAssets(token).then((r) => setAssets(r.assets));
  }, [token]);

  useEffect(() => { refresh(); }, [refresh]);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>, assetType: string) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        await launchpadPublic.uploadAsset(token, file, assetType);
      }
      refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const TYPES: Array<{ value: string; label: string; hint: string }> = [
    { value: 'logo', label: 'Logo', hint: 'PNG with transparency, plus a 1:1 social variant' },
    { value: 'product_photo', label: 'Product photos', hint: 'Min 5 — front, hand-held, lifestyle' },
    { value: 'founder_photo', label: 'Founder photos', hint: 'For about / story content' },
    { value: 'brand_guide', label: 'Brand guide', hint: 'PDF or any reference doc' },
    { value: 'finalized_post', label: 'Finalized posts (visuals + captions)', hint: 'Per the 30-day calendar' },
    { value: 'video', label: 'Videos / reels', hint: 'Raw or edited' },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold">Upload your finalized assets</h2>
      <p className="text-stone-400">Everything needed to ship the 30-day sprint. All uploads land in your private Google Drive folder.</p>
      {session.driveFolderUrl && (
        <a href={session.driveFolderUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-300 text-sm underline">
          Open my Drive folder ↗
        </a>
      )}

      {error && <div className="text-sm text-red-400">{error}</div>}

      <div className="grid gap-3">
        {TYPES.map((t) => {
          const matching = assets.filter((a) => a.asset_type === t.value);
          return (
            <div key={t.value} className="border border-stone-800 rounded p-4">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="font-medium text-stone-200">{t.label}</div>
                  <div className="text-xs text-stone-500">{t.hint}</div>
                </div>
                <label className="cursor-pointer px-3 py-1.5 text-xs bg-stone-800 hover:bg-stone-700 rounded">
                  {uploading ? 'Uploading…' : '+ Upload'}
                  <input type="file" multiple className="hidden" onChange={(e) => onUpload(e, t.value)} disabled={uploading} />
                </label>
              </div>
              {matching.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {matching.map((a) => (
                    <a key={a.id} href={a.drive_file_url} target="_blank" rel="noopener noreferrer"
                       className="text-xs px-2 py-1 bg-teal-900/40 border border-teal-800 text-teal-200 rounded hover:bg-teal-900/60">
                      {a.filename}
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepSubmit({ session, onSubmit, submitting }: { session: Session; onSubmit: () => void; submitting: boolean }) {
  if (session.status === 'submitted' || session.status === 'in_review') {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-cyan-300">Submitted ✓</h2>
        <p className="text-stone-400">Your launch package is in review. We'll email you when it's approved or if anything needs adjustment.</p>
      </div>
    );
  }
  if (session.status === 'approved') {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-cyan-300">Approved ✓ Ready to launch.</h2>
        <p className="text-stone-400">Your 30-day sprint will start on {session.launchDate}.</p>
      </div>
    );
  }
  return (
    <div className="space-y-5">
      <h2 className="text-2xl font-semibold">Submit for final review</h2>
      <p className="text-stone-400">Once you submit, your launch manager will review every module + every asset. You'll get an email within 48 hours with approval or notes.</p>
      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting}
        className="px-6 py-3 bg-cyan-500 hover:bg-cyan-400 text-stone-950 font-semibold rounded disabled:opacity-30"
      >
        {submitting ? 'Submitting…' : 'Submit for review'}
      </button>
    </div>
  );
}
