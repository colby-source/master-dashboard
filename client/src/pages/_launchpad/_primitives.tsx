import { useState } from 'react';

const CYAN = '#1AE7F6';

// ─── Layout ────────────────────────────────────────────────────────────────

export function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="min-h-screen flex items-center justify-center px-6"
      style={{ background: `radial-gradient(ellipse 70% 40% at 50% 0%, rgba(26,231,246,0.07) 0%, transparent 65%), #0D0D0D` }}
    >
      {children}
    </div>
  );
}

// ─── Step hero ─────────────────────────────────────────────────────────────

export function StepHeader({
  step,
  title,
  subtitle,
}: {
  step?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-8">
      {step && (
        <div className="text-[11px] font-mono tracking-[0.18em] uppercase mb-3" style={{ color: `${CYAN}99` }}>
          {step}
        </div>
      )}
      <h2 className="text-3xl font-bold tracking-tight text-white">{title}</h2>
      {subtitle && (
        <p className="text-sm text-white/40 mt-2 leading-relaxed max-w-lg">{subtitle}</p>
      )}
    </div>
  );
}

// ─── Form primitives ────────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/40">{label}</div>
      {hint && <div className="text-xs text-white/25 leading-relaxed">{hint}</div>}
      {children}
    </div>
  );
}

const inputCls =
  'w-full bg-white/[0.04] border border-white/[0.08] focus:border-[#1AE7F6]/50 focus:bg-white/[0.07] ' +
  'focus:shadow-[0_0_0_4px_rgba(26,231,246,0.06)] rounded-xl px-4 py-3.5 text-white ' +
  'placeholder-white/20 outline-none transition-all duration-200 text-[15px]';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ''}`} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`${inputCls.replace('py-3.5', 'py-3')} resize-none ${props.className ?? ''}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...props} className={`${inputCls} appearance-none pr-10 ${props.className ?? ''}`} />
      <div className="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-white/30">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <path d="M2 3.5l3.5 3.5L9 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
}

export function Chips({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState('');
  const add = () => {
    const v = input.trim();
    if (!v) return;
    onChange([...values, v]);
    setInput('');
  };
  return (
    <div className="space-y-2">
      {values.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {values.map((v, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
              style={{
                background: 'rgba(26,231,246,0.08)',
                border: '1px solid rgba(26,231,246,0.22)',
                color: CYAN,
              }}
            >
              {v}
              <button
                type="button"
                onClick={() => onChange(values.filter((_, j) => j !== i))}
                className="opacity-50 hover:opacity-100 transition-opacity leading-none"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); add(); }
          }}
          placeholder={placeholder ?? 'Type and press Enter'}
          className={`${inputCls} flex-1`}
        />
        <button
          type="button"
          onClick={add}
          className="px-4 py-3 text-sm font-medium bg-white/[0.05] hover:bg-white/[0.09] text-white/60 hover:text-white rounded-xl border border-white/[0.08] transition-all duration-200 whitespace-nowrap"
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ─── Panel / Card ───────────────────────────────────────────────────────────

export function Panel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-white/[0.06] bg-white/[0.025] p-5 ${className}`}>
      {children}
    </div>
  );
}

// ─── Buttons ────────────────────────────────────────────────────────────────

export function PrimaryBtn({
  children,
  disabled,
  onClick,
  type = 'button',
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-2 px-7 py-3 text-sm font-bold text-[#0D0D0D] rounded-full disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
      style={
        disabled
          ? { background: '#555' }
          : {
              background: 'linear-gradient(135deg, #1AE7F6 0%, #0A9396 100%)',
              boxShadow: '0 0 22px rgba(26,231,246,0.22)',
            }
      }
    >
      {children}
    </button>
  );
}

export function GhostBtn({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white/60 hover:text-white bg-white/[0.04] hover:bg-white/[0.08] rounded-xl border border-white/[0.08] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-200"
    >
      {children}
    </button>
  );
}
