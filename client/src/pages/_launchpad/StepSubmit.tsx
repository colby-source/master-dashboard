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
