import { Field, Textarea, Chips } from './_primitives';
import type { StepProps } from './_types';

export function StepVoice({ intake, update }: StepProps) {
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
