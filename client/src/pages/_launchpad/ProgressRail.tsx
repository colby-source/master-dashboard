interface Props {
  steps: readonly { id: string; title: string }[];
  current: number;
}

export function ProgressRail({ steps, current }: Props) {
  const pct = steps.length > 1 ? (current / (steps.length - 1)) * 100 : 0;

  return (
    <div className="mb-10">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-mono tracking-[0.16em] uppercase" style={{ color: 'rgba(26,231,246,0.55)' }}>
          {current + 1}&nbsp;/&nbsp;{steps.length}
        </span>
        <span className="text-[11px] font-medium text-white/35">{steps[current].title}</span>
      </div>

      {/* Gradient fill bar */}
      <div className="relative h-[3px] bg-white/[0.06] rounded-full overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${pct}%`,
            background: 'linear-gradient(90deg, #0A9396 0%, #1AE7F6 100%)',
            boxShadow: pct > 0 ? '0 0 8px rgba(26,231,246,0.35)' : 'none',
          }}
        />
      </div>

      {/* Segment dots */}
      <div className="flex items-center gap-0.5 mt-2">
        {steps.map((s, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <div
              key={s.id}
              title={s.title}
              className="flex-1 h-0.5 rounded-full transition-all duration-300"
              style={{
                background: done
                  ? 'rgba(26,231,246,0.55)'
                  : active
                  ? '#1AE7F6'
                  : 'rgba(255,255,255,0.06)',
                boxShadow: active ? '0 0 6px rgba(26,231,246,0.5)' : 'none',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
