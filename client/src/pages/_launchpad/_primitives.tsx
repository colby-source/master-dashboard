/**
 * Shared form primitives for Launchpad wizard steps. Pulled out of
 * LaunchpadPublicPage.tsx so multi-file wizard steps (StepProducts,
 * StepCompliance, future Phase 3 steps) reuse the same look and behavior.
 */

import { useState } from 'react';

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-sm font-medium text-stone-200 mb-1.5">{label}</div>
      {hint && <div className="text-xs text-stone-500 mb-2">{hint}</div>}
      {children}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full bg-stone-900 border border-stone-800 focus:border-cyan-500 rounded px-3 py-2.5 text-stone-100 placeholder-stone-600 outline-none transition ${props.className || ''}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full bg-stone-900 border border-stone-800 focus:border-cyan-500 rounded px-3 py-2.5 text-stone-100 outline-none transition ${props.className || ''}`}
    />
  );
}

export function Chips({ values, onChange, placeholder }: { values: string[]; onChange: (next: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState('');
  const add = () => {
    const v = input.trim();
    if (!v) return;
    onChange([...values, v]);
    setInput('');
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {values.map((v, i) => (
          <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-teal-900/50 border border-teal-800 text-teal-200 text-xs rounded">
            {v}
            <button type="button" onClick={() => onChange(values.filter((_, j) => j !== i))} className="hover:text-white">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <Input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={placeholder || 'Type and press Enter'} />
        <button type="button" onClick={add} className="px-3 py-2 text-sm bg-stone-800 hover:bg-stone-700 text-stone-200 rounded">Add</button>
      </div>
    </div>
  );
}

export function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `$${n.toFixed(2)}`;
}

export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
}
