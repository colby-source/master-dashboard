/**
 * Welcome / intro screen — shown ONCE before the wizard rail starts.
 *
 * Pure presentational. No API calls. Advances to the first real step
 * (`identity`) on CTA click.
 */

import { PrimaryBtn } from './_primitives';

interface Props {
  brandName: string;
  onStart: () => void;
}

const BULLETS: { title: string; detail: string }[] = [
  {
    title: '12 quick steps to define your brand',
    detail: 'Around 30–45 minutes of focused work. Be specific — vague answers make weak strategies.',
  },
  {
    title: 'You\'ll get a 30-day launch package',
    detail: 'Master strategy, ICP psychology, content pillars, 30-day calendar, 50-hook bank, and monetization funnel.',
  },
  {
    title: 'Save and come back anytime',
    detail: 'Everything autosaves. Close the tab, reopen the link, pick up exactly where you left off.',
  },
  {
    title: 'We review every module before going live',
    detail: 'Your launch manager hand-checks each piece. You\'ll never publish something we haven\'t signed off on.',
  },
  {
    title: 'Stuck? Reply to your launch manager email',
    detail: 'A real human is on call. No bots, no chatbox loops.',
  },
];

export function StepWelcome({ brandName, onStart }: Props) {
  return (
    <div className="space-y-10">
      {/* Hero block */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-8 sm:p-12 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        {/* Decorative accent — soft cyan halo, top-right */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full opacity-60"
          style={{
            background:
              'radial-gradient(circle at center, rgba(26,231,246,0.32) 0%, rgba(26,231,246,0) 70%)',
          }}
        />
        {/* Decorative accent strip */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 h-full w-1.5"
          style={{ background: 'linear-gradient(180deg, #1AE7F6 0%, #0A9396 100%)' }}
        />

        <div className="relative">
          <div
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.18em] mb-6"
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
            Brand Me Now · Launchpad
          </div>

          <h1
            className="text-4xl sm:text-5xl font-bold tracking-tight text-slate-900"
            style={{ letterSpacing: '-0.025em' }}
          >
            Welcome to {brandName}'s
            <br />
            <span
              style={{
                background: 'linear-gradient(135deg, #0A9396 0%, #1AE7F6 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              launch portal.
            </span>
          </h1>

          <p className="text-lg text-slate-600 mt-5 leading-relaxed max-w-xl">
            This is where your brand goes from idea to a live, content-ready creator
            business. We've built every step around what actually moves the needle —
            no fluff, no busywork.
          </p>
        </div>
      </div>

      {/* What to expect */}
      <div className="space-y-1">
        <div
          className="text-[11px] font-mono tracking-[0.18em] uppercase mb-4"
          style={{ color: '#016F74' }}
        >
          What to expect
        </div>
        <div className="space-y-3">
          {BULLETS.map((b, i) => (
            <div
              key={i}
              className="flex items-start gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
            >
              <div
                className="shrink-0 flex items-center justify-center h-8 w-8 rounded-full text-xs font-bold"
                style={{
                  background: 'linear-gradient(135deg, rgba(26,231,246,0.18) 0%, rgba(10,147,150,0.20) 100%)',
                  color: '#016F74',
                  border: '1px solid rgba(10,147,150,0.25)',
                }}
              >
                {i + 1}
              </div>
              <div className="min-w-0">
                <div className="text-slate-900 font-semibold leading-tight">{b.title}</div>
                <div className="text-sm text-slate-600 mt-1 leading-relaxed">{b.detail}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CTA */}
      <div className="flex items-center gap-4 pt-2">
        <PrimaryBtn onClick={onStart}>Let's go →</PrimaryBtn>
        <span className="text-xs text-slate-500">~30–45 min · autosaves as you go</span>
      </div>
    </div>
  );
}
