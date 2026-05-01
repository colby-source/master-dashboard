import { Field, Input, Textarea, Chips } from './_primitives';
import type { StepWithNestedProps } from './_types';

export function StepAudience({ intake, updateNested }: StepWithNestedProps) {
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
