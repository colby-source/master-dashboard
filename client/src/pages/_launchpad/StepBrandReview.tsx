/**
 * StepBrandReview — Read-only brand direction review for the creator.
 *
 * Shown INSTEAD of the data-entry steps (identity, story, audience, competition,
 * channels, voice) when the admin has pre-baked the brand direction before
 * sending the magic link (intake.admin_prep_sealed is set).
 *
 * The creator:
 *   1. Reviews each section (read-only)
 *   2. Can leave a comment / request changes per section
 *   3. Approves the full brand direction with one click
 *
 * Comments are saved to intake.creator_feedback[sectionId].
 * Sign-off is saved to intake.review_signoffs.brand_direction.
 */

import { useState } from 'react';
import type { IntakeData, IntakePatch } from './_types';
import { StepHeader, Panel, PrimaryBtn, Textarea } from './_primitives';

interface Props {
  intake: IntakeData;
  update: (patch: IntakePatch) => void;
  onApprove: () => void;
}

// ── Section definitions ───────────────────────────────────────────────────────

interface Section {
  id: string;
  title: string;
  render: (intake: IntakeData) => React.ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: 'identity',
    title: 'Brand identity',
    render: (intake) => (
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FieldView label="Brand name" value={intake.brand_name} />
        <FieldView label="Founder" value={intake.founder_name} />
        {intake.founder_handle && <FieldView label="Primary handle" value={intake.founder_handle} />}
        <FieldView label="Niche" value={intake.niche} className="sm:col-span-2" />
        <ChipsView label="Product categories" values={intake.product_categories} className="sm:col-span-2" />
      </dl>
    ),
  },
  {
    id: 'story',
    title: 'Brand story',
    render: (intake) => (
      <dl className="space-y-4">
        <FieldView label="Why this brand?" value={intake.founder_story} long />
        {intake.origin_moment && <FieldView label="Origin moment" value={intake.origin_moment} long />}
        <FieldView label="Signature belief" value={intake.signature_belief} long />
      </dl>
    ),
  },
  {
    id: 'audience',
    title: 'Target audience',
    render: (intake) => {
      const icp = intake.primary_icp;
      if (!icp) return <div className="text-slate-500 text-sm italic">No audience data yet.</div>;
      return (
        <dl className="space-y-4">
          {icp.demographic && <FieldView label="Demographic" value={icp.demographic} long />}
          {icp.psychographic && <FieldView label="Psychographic" value={icp.psychographic} long />}
          {icp.where_they_hang_out && icp.where_they_hang_out.length > 0 && (
            <ChipsView label="Where they hang out" values={icp.where_they_hang_out} />
          )}
        </dl>
      );
    },
  },
  {
    id: 'competition',
    title: 'Competitive landscape',
    render: (intake) => {
      const comps = intake.top_3_competitors;
      return (
        <div className="space-y-3">
          {intake.category_status && (
            <FieldView label="Category status" value={String(intake.category_status)} />
          )}
          {comps && comps.length > 0 ? (
            comps.map((c, i) => (
              <Panel key={i} className="space-y-2">
                <div className="font-semibold text-slate-900">
                  {c.name || `Competitor ${i + 1}`}
                  {c.handle && <span className="text-slate-500 font-normal ml-2 text-sm">({c.handle})</span>}
                </div>
                {c.what_we_do_differently && (
                  <div className="text-sm text-slate-600">{c.what_we_do_differently}</div>
                )}
              </Panel>
            ))
          ) : (
            <div className="text-slate-500 text-sm italic">No competitors entered.</div>
          )}
        </div>
      );
    },
  },
  {
    id: 'voice',
    title: 'Brand voice',
    render: (intake) => (
      <dl className="space-y-4">
        <ChipsView label="How this brand talks" values={intake.brand_voice_dos} />
        <ChipsView label="What it never sounds like" values={intake.brand_voice_donts} />
        {intake.off_limits_topics && intake.off_limits_topics.length > 0 && (
          <ChipsView label="Off-limits topics" values={intake.off_limits_topics} />
        )}
        {intake.visual_style_notes && (
          <FieldView label="Visual style notes" value={intake.visual_style_notes} long />
        )}
        {intake.legal_constraints && intake.legal_constraints.length > 0 && (
          <ChipsView label="Legal constraints" values={intake.legal_constraints} />
        )}
      </dl>
    ),
  },
  {
    id: 'channels',
    title: 'Channels & goals',
    render: (intake) => (
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <FieldView label="Primary platform" value={intake.primary_platform} />
        <FieldView label="Posting capacity" value={intake.posting_capacity} />
        {intake.secondary_platforms && intake.secondary_platforms.length > 0 && (
          <ChipsView label="Secondary platforms" values={intake.secondary_platforms} className="sm:col-span-2" />
        )}
        <FieldView label="Launch date" value={intake.launch_date} />
        <FieldView label="Primary goal" value={intake.primary_goal} />
        {intake.monetization_model && intake.monetization_model.length > 0 && (
          <ChipsView label="Monetization models" values={intake.monetization_model} className="sm:col-span-2" />
        )}
        {intake.price_point_range && <FieldView label="Price point range" value={intake.price_point_range} />}
      </dl>
    ),
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

export function StepBrandReview({ intake, update, onApprove }: Props) {
  const signedOff = !!(intake.review_signoffs?.brand_direction);
  const feedback: Record<string, string> = (intake.creator_feedback as Record<string, string>) || {};

  const [localFeedback, setLocalFeedback] = useState<Record<string, string>>(feedback);
  const [expandedFeedback, setExpandedFeedback] = useState<Set<string>>(new Set());

  const saveFeedback = (sectionId: string, text: string) => {
    const next = { ...localFeedback, [sectionId]: text };
    setLocalFeedback(next);
    update({ creator_feedback: next });
  };

  const toggleFeedback = (sectionId: string) => {
    setExpandedFeedback((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) next.delete(sectionId);
      else next.add(sectionId);
      return next;
    });
  };

  const approve = () => {
    update({
      review_signoffs: {
        ...(intake.review_signoffs || {}),
        brand_direction: new Date().toISOString(),
      },
    });
    onApprove();
  };

  const pendingFeedback = Object.values(localFeedback).filter((v) => v.trim().length > 0).length;

  return (
    <div className="space-y-6">
      <StepHeader
        step="Brand direction review"
        title="Your brand direction"
        subtitle="BMN has built your brand strategy. Review each section below. Leave a comment if anything needs tweaking — then approve to continue."
      />

      {/* BRAND DIRECTION badge */}
      <div
        className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[11px] font-bold uppercase tracking-widest"
        style={{
          background: 'rgba(26,231,246,0.12)',
          border: '1px solid rgba(10,147,150,0.35)',
          color: '#016F74',
        }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ background: '#0A9396' }}
        />
        Brand direction — built by BMN
      </div>

      {/* Section cards */}
      <div className="space-y-4">
        {SECTIONS.map((section) => {
          const hasFeedback = !!(localFeedback[section.id]?.trim());
          const feedbackOpen = expandedFeedback.has(section.id);

          return (
            <Panel key={section.id} className="space-y-4">
              {/* Section header */}
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-semibold text-slate-900">{section.title}</h3>
                <button
                  type="button"
                  onClick={() => toggleFeedback(section.id)}
                  className="shrink-0 text-[11px] font-medium px-3 py-1.5 rounded-full transition-all duration-200"
                  style={
                    hasFeedback
                      ? {
                          background: 'rgba(245,158,11,0.12)',
                          border: '1px solid rgba(245,158,11,0.40)',
                          color: 'rgb(146,64,14)',
                        }
                      : {
                          background: 'rgba(26,231,246,0.10)',
                          border: '1px solid rgba(10,147,150,0.25)',
                          color: '#016F74',
                        }
                  }
                >
                  {hasFeedback ? 'Comment pending' : (feedbackOpen ? 'Close comment' : 'Comment / request changes')}
                </button>
              </div>

              {/* Read-only content */}
              <div className="text-sm text-slate-700 leading-relaxed">
                {section.render(intake)}
              </div>

              {/* Inline comment box */}
              {feedbackOpen && (
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                    Your comment for this section
                  </div>
                  <Textarea
                    rows={3}
                    placeholder="What should we adjust? Be as specific as possible."
                    value={localFeedback[section.id] || ''}
                    onChange={(e) => saveFeedback(section.id, e.target.value)}
                  />
                  {hasFeedback && (
                    <button
                      type="button"
                      onClick={() => saveFeedback(section.id, '')}
                      className="text-[11px] text-slate-500 hover:text-slate-800 underline transition-colors"
                    >
                      Clear comment
                    </button>
                  )}
                </div>
              )}
            </Panel>
          );
        })}
      </div>

      {/* Approve / sign-off */}
      <div className="pt-4 border-t border-slate-200 space-y-4">
        {pendingFeedback > 0 && (
          <Panel className="border-amber-200 bg-amber-50">
            <p className="text-sm text-amber-800">
              <strong>You have {pendingFeedback} pending comment{pendingFeedback > 1 ? 's' : ''}.</strong> Your
              comments are saved and will be reviewed by your launch manager. You can still approve and continue
              — approving means you are OK with the overall direction and understand changes may follow.
            </p>
          </Panel>
        )}

        {signedOff ? (
          <div className="flex items-center gap-3 text-sm">
            <span
              className="w-5 h-5 rounded-md flex items-center justify-center text-xs font-bold"
              style={{ background: 'rgb(16,185,129)', color: '#fff' }}
            >
              ✓
            </span>
            <span className="text-slate-700">
              Brand direction approved{' '}
              <span className="text-slate-500">
                {new Date(intake.review_signoffs!.brand_direction!).toLocaleString()}
              </span>
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <PrimaryBtn onClick={approve}>
              Approve brand direction →
            </PrimaryBtn>
            <span className="text-xs text-slate-500">
              {pendingFeedback > 0
                ? 'Approve with comments noted above.'
                : 'Looks good? Approve to continue.'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Display primitives ────────────────────────────────────────────────────────

function FieldView({
  label,
  value,
  long = false,
  className = '',
}: {
  label: string;
  value: string | undefined | null;
  long?: boolean;
  className?: string;
}) {
  if (!value || String(value).trim().length === 0) return null;
  return (
    <div className={className}>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-1">{label}</dt>
      <dd className={`text-slate-800 ${long ? 'leading-relaxed whitespace-pre-line' : ''}`}>
        {String(value)}
      </dd>
    </div>
  );
}

function ChipsView({
  label,
  values,
  className = '',
}: {
  label: string;
  values: string[] | undefined | null;
  className?: string;
}) {
  if (!values || values.length === 0) return null;
  return (
    <div className={className}>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500 mb-2">{label}</dt>
      <dd className="flex flex-wrap gap-1.5">
        {values.map((v, i) => (
          <span
            key={i}
            className="px-2.5 py-1 text-xs rounded-full"
            style={{
              background: 'rgba(26,231,246,0.10)',
              border: '1px solid rgba(10,147,150,0.30)',
              color: '#016F74',
            }}
          >
            {v}
          </span>
        ))}
      </dd>
    </div>
  );
}
