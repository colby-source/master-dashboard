import { StepHeader, PrimaryBtn } from './_primitives';
import type { Session } from './_types';

interface Props {
  session: Session;
  onSubmit: () => void;
  submitting: boolean;
}

export function StepSubmit({ session, onSubmit, submitting }: Props) {
  if (session.status === 'submitted' || session.status === 'in_review') {
    return (
      <div className="space-y-4">
        <StepHeader
          step="12 / Submitted"
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
          step="12 / Approved"
          title="Approved ✓ Ready to launch."
          subtitle={session.launchDate ? `Your 30-day sprint will start on ${session.launchDate}.` : 'Your 30-day sprint is ready to start.'}
        />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <StepHeader
        step="12 / Submit"
        title="Submit for final review"
        subtitle="Once you submit, your launch manager will review every module + every asset. Email reply within 48 hours with approval or notes."
      />
      <PrimaryBtn onClick={onSubmit} disabled={submitting}>
        {submitting ? 'Submitting…' : 'Submit for review →'}
      </PrimaryBtn>
    </div>
  );
}
