interface Props {
  steps: readonly { id: string; title: string }[];
  current: number;
}

export function ProgressRail({ steps, current }: Props) {
  // current may be -1 when off-rail (welcome) — clamp for layout, hide counter
  const onRail = current >= 0 && current < steps.length;
  const safeIdx = onRail ? current : 0;
  const pct = steps.length > 1 ? (safeIdx / (steps.length - 1)) * 100 : 0;

  return (
    <div className="mb-10">
      <div className="flex items-center justify-between mb-3">
        {onRail ? (
          <span
            className="text-[11px] font-mono tracking-[0.16em] uppercase"
            style={{ color: '#016F74' }}
          >
            {safeIdx + 1}&nbsp;/&nbsp;{steps.length}
          </span>
        ) : (
          <span
            className="text-[11px] font-mono tracking-[0.16em] uppercase"
            style={{ color: '#016F74' }}
          >
            Welcome
          </span>
        )}
        <span className="text-[11px] font-medium text-slate-500">
          {onRail ? steps[safeIdx].title : 'Get started'}
        </span>
      </div>

      {/* Gradient fill bar */}
      <div className="relative h-[3px] bg-slate-200 rounded-full overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out"
          style={{
            width: onRail ? `${pct}%` : '0%',
            background: 'linear-gradient(90deg, #0A9396 0%, #1AE7F6 100%)',
            boxShadow: pct > 0 ? '0 0 10px rgba(26,231,246,0.45)' : 'none',
          }}
        />
      </div>

      {/* Segment dots */}
      <div className="flex items-center gap-0.5 mt-2">
        {steps.map((s, i) => {
          const done = onRail && i < safeIdx;
          const active = onRail && i === safeIdx;
          return (
            <div
              key={s.id}
              title={s.title}
              className="flex-1 h-0.5 rounded-full transition-all duration-300"
              style={{
                background: done
                  ? 'rgba(10,147,150,0.65)'
                  : active
                  ? '#0A9396'
                  : 'rgba(15,23,42,0.10)',
                boxShadow: active ? '0 0 6px rgba(26,231,246,0.55)' : 'none',
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
