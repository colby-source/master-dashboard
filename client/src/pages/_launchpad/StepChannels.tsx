import { Field, Input, Select, Chips, StepHeader } from './_primitives';
import type { StepProps, PrimaryPlatform, PostingCapacity, PrimaryGoal } from './_types';

export function StepChannels({ intake, update }: StepProps) {
  return (
    <div className="space-y-6">
      <StepHeader
        step="07 / Channels"
        title="Channels & goals"
        subtitle="Where you'll show up, how often, and what success looks like in 30 days."
      />
      <Field label="Primary platform" hint="Where you'll spend the most energy.">
        <Select
          value={intake.primary_platform || ''}
          onChange={(e) => update({ primary_platform: e.target.value as PrimaryPlatform | '' })}
        >
          <option value="">Select…</option>
          <option value="instagram">Instagram</option>
          <option value="tiktok">TikTok</option>
          <option value="youtube">YouTube</option>
          <option value="linkedin">LinkedIn</option>
          <option value="twitter">Twitter / X</option>
        </Select>
      </Field>
      <Field label="Secondary platforms" hint="Cross-post / repurpose.">
        <Chips
          values={intake.secondary_platforms || []}
          onChange={(v) => update({ secondary_platforms: v })}
          placeholder="instagram, tiktok…"
        />
      </Field>
      <Field label="Posting capacity">
        <Select
          value={intake.posting_capacity || ''}
          onChange={(e) => update({ posting_capacity: e.target.value as PostingCapacity | '' })}
        >
          <option value="">Select…</option>
          <option value="daily">Daily — 30 posts in 30 days</option>
          <option value="every_other_day">Every other day — ~15 posts</option>
          <option value="3x_week">3× per week — ~13 posts</option>
        </Select>
      </Field>
      <Field label="Launch date" hint="When does the first post go live?">
        <Input
          type="date"
          value={intake.launch_date || ''}
          onChange={(e) => update({ launch_date: e.target.value })}
        />
      </Field>
      <Field label="Primary goal" hint="What does the first 30 days need to deliver?">
        <Select
          value={intake.primary_goal || ''}
          onChange={(e) => update({ primary_goal: e.target.value as PrimaryGoal | '' })}
        >
          <option value="">Select…</option>
          <option value="awareness">Awareness — reach + brand recognition</option>
          <option value="list_build">List build — capture emails/SMS</option>
          <option value="sales">Sales — direct DTC purchases</option>
          <option value="community">Community — deep engagement</option>
        </Select>
      </Field>
      <Field label="Monetization model" hint="Pick all that apply.">
        <Chips
          values={intake.monetization_model || []}
          onChange={(v) => update({ monetization_model: v })}
          placeholder="dtc, affiliate, live_selling, wholesale, membership"
        />
      </Field>
      <Field label="Price point range" hint='e.g. "$28 cleanser to $65 serum"'>
        <Input
          value={intake.price_point_range || ''}
          onChange={(e) => update({ price_point_range: e.target.value })}
        />
      </Field>
    </div>
  );
}
