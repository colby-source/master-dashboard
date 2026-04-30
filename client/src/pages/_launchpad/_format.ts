/**
 * Pure formatters used across Launchpad wizard steps. Kept in their own
 * module so React Fast Refresh can hot-reload the component files without
 * triggering a full reload (Vite's react-refresh plugin requires component
 * files to ONLY export components).
 */

export function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `$${n.toFixed(2)}`;
}

export function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
}
