import { Field, Input, Chips } from './_primitives';
import type { StepProps } from './_types';

export function StepIdentity({ intake, update }: StepProps) {
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
