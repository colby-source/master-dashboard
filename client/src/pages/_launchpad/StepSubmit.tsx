import { StepHeader, Panel, PrimaryBtn } from './_primitives';
import type { Session } from './_types';

interface Props {
  session: Session;
  onSubmit: () => void;
  submitting: boolean;
  /** True when admin has pre-baked brand direction before sending the link. */
  prebaked?: boolean;
  /** Whether creator has signed off on brand direction review. */
  brandDirectionApproved?: boolean;
  /** Whether creator has signed off on assets review. */
  assetsApproved?: boolean;
  /** Whether universal compliance gates are all acknowledged. */
  universalReady?: boolean;
}

export function StepSubmit({
  session,
  onSubmit,
  submitting,
  prebaked = false,
  brandDirectionApproved = true,
  assetsApproved = true,
  universalReady = true,
}: Props) {
  if (session.status === 'submitted' || session.status === 'in_review') {
    return (
      <div className="space-y-4">
        <StepHeader
          step="Submit"
          title="Submitted ✓"
          subtitle="Your launch package is in review. We'll email you within 48 hours with approval or notes."
        />
      </div>
    );
  }
  if (session.status === 'approved') {
    return (
      <div className="space-y-4">
        <StepHeader
          step="Approved"
          title="Approved ✓ Ready to launch."
          subtitle={session.launchDate ? `Your 30-day sprint will start on ${session.launchDate}.` : 'Your 30-day sprint is ready to start.'}
        />
      </div>
    );
  }

  // Gates for pre-baked flow
  const gates = prebaked
    ? [
        { label: 'Brand direction reviewed', met: brandDirectionApproved },
        { label: 'Brand assets reviewed', met: assetsApproved },
        { label: 'Universal compliance acknowledged', met: universalReady },
      ]
    : [
        { label: 'Universal compliance acknowledged', met: universalReady },
      ];

  const allGatesMet = gates.every((g) => g.met);

  return (
    <div className="space-y-6">
      <StepHeader
        step="Submit"
        title="Submit for final review"
        subtitle="Once you submit, your launch manager will review everything. Email reply within 48 hours with approval or notes."
      />

      {/* Gate checklist */}
      <Panel className="space-y-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
          Required before submitting
        </div>
        <ul className="space-y-2">
          {gates.map((gate) => (
            <li key={gate.label} className="flex items-center gap-3 text-sm">
              <span
                className="w-5 h-5 shrink-0 rounded-md flex items-center justify-center text-xs font-bold transition-all"
                style={
                  gate.met
                    ? { background: 'rgb(16,185,129)', color: '#fff' }
                    : { background: '#fff', border: '1.5px solid #CBD5E1', color: 'transparent' }
                }
              >
                ✓
              </span>
              <span className={gate.met ? 'text-slate-800' : 'text-slate-500'}>{gate.label}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <PrimaryBtn onClick={onSubmit} disabled={submitting || !allGatesMet}>
        {submitting ? 'Submitting…' : 'Submit for review →'}
      </PrimaryBtn>

      {!allGatesMet && (
        <p className="text-xs text-slate-500">
          Complete the items above before submitting.
        </p>
      )}
    </div>
  );
}
