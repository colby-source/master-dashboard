import { Field, Input, Textarea, Select, StepHeader, Panel } from './_primitives';
import type { StepProps, CompetitorEntry, CategoryStatus } from './_types';

export function StepCompetition({ intake, update }: StepProps) {
  const competitors = intake.top_3_competitors || [];
  const updateCompetitor = (i: number, patch: Partial<CompetitorEntry>) => {
    const next = competitors.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
    while (next.length < 3) next.push({});
    update({ top_3_competitors: next });
  };
  return (
    <div className="space-y-6">
      <StepHeader
        step="04 / Competition"
        title="Competition"
        subtitle="Name 3 brands customers compare you to. For each, what do you do meaningfully differently — be specific, not 'better quality'."
      />
      {[0, 1, 2].map((i) => (
        <Panel key={i} className="space-y-3">
          <div className="text-[10px] font-mono uppercase tracking-[0.18em]" style={{ color: '#016F74' }}>
            Competitor {i + 1}
          </div>
          <Input
            placeholder="Brand name"
            value={competitors[i]?.name || ''}
            onChange={(e) => updateCompetitor(i, { name: e.target.value })}
          />
          <Input
            placeholder="@handle (optional)"
            value={competitors[i]?.handle || ''}
            onChange={(e) => updateCompetitor(i, { handle: e.target.value })}
          />
          <Textarea
            rows={2}
            placeholder="What do you do differently?"
            value={competitors[i]?.what_we_do_differently || ''}
            onChange={(e) => updateCompetitor(i, { what_we_do_differently: e.target.value })}
          />
        </Panel>
      ))}
      <Field label="Your category status">
        <Select
          value={intake.category_status || ''}
          onChange={(e) => update({ category_status: e.target.value as CategoryStatus | '' })}
        >
          <option value="">Select…</option>
          <option value="new">New — I'm creating this category</option>
          <option value="emerging">Emerging — early adopters are finding it</option>
          <option value="crowded">Crowded — I'm displacing incumbents</option>
          <option value="declining">Declining — incumbents losing trust</option>
        </Select>
      </Field>
    </div>
  );
}
