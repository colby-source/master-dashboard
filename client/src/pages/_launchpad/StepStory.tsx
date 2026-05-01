import { Field, Textarea } from './_primitives';
import type { StepProps } from './_types';

export function StepStory({ intake, update }: StepProps) {
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
