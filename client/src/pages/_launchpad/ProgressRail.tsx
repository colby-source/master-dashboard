interface Props {
  steps: readonly { id: string; title: string }[];
  current: number;
}

export function ProgressRail({ steps, current }: Props) {
  return (
    <div className="flex items-center gap-1 mb-8">
      {steps.map((s, i) => (
        <div key={s.id} className="flex-1 flex flex-col gap-1">
          <div className={`h-1 rounded-full ${i <= current ? 'bg-cyan-400' : 'bg-stone-800'}`} />
          <div className={`text-[10px] uppercase tracking-wider ${i === current ? 'text-cyan-300' : 'text-stone-600'}`}>
            {s.title}
          </div>
        </div>
      ))}
    </div>
  );
}
