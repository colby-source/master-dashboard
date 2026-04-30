/**
 * Wizard Step 5 — Product line + SKUs.
 *
 * Browses the BMN PLDS catalog (skincare, cosmetics, selfnamed, supplements)
 * and lets the creator pick:
 *   - 1 hero SKU       (the launch flagship)
 *   - 1-2 support SKUs (cross-sells / bundle ladder)
 *   - 0+ bundle SKUs   (explicit bundle composition)
 *
 * Margin / MOQ / compliance flags are surfaced on every card so creators
 * can pick economically-viable products. PUTting selections wholesale
 * keeps the data model dead simple — the server snapshots whatever the
 * UI sent at submission time.
 */

import { useEffect, useMemo, useState } from 'react';
import { launchpadPublic } from '../../lib/api/launchpad';
import type { BmnCatalogItemDto, BrandSkuDto, CatalogSource } from '../../lib/api/launchpad';
import { Field, Input, Select, fmtUsd, fmtPct } from './_primitives';

export type SkuRole = 'hero' | 'support' | 'bundle';

interface Selection {
  catalogItemId: string;
  role: SkuRole;
  customName?: string;
  customMsrpUsd?: number;
}

const SOURCES: { value: CatalogSource; label: string }[] = [
  { value: 'skincare', label: 'Skincare' },
  { value: 'cosmetics', label: 'Cosmetics' },
  { value: 'selfnamed', label: 'Selfnamed (full catalog)' },
  { value: 'supplements', label: 'Supplements' },
];

export function StepProducts({ token, onComplete }: { token: string; onComplete?: () => void }) {
  const [source, setSource] = useState<CatalogSource>('skincare');
  const [category, setCategory] = useState<string>('');
  const [search, setSearch] = useState('');
  const [minMargin, setMinMargin] = useState<number>(0);
  const [items, setItems] = useState<BmnCatalogItemDto[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [savedSkus, setSavedSkus] = useState<BrandSkuDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial: load categories for the active source + saved selections.
  useEffect(() => {
    setLoading(true);
    Promise.all([
      launchpadPublic.getCatalogCategories(token, source),
      launchpadPublic.getSkus(token),
    ])
      .then(([cats, skus]) => {
        setCategories(cats.categories);
        setSavedSkus(skus.skus);
        // Hydrate selections from server-saved SKUs on first mount only
        setSelections((prev) =>
          prev.length === 0
            ? skus.skus.map((s) => ({
                catalogItemId: s.catalogItemId,
                role: s.role,
                customName: s.customName ?? undefined,
                customMsrpUsd: s.customMsrpUsd ?? undefined,
              }))
            : prev,
        );
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, source]);

  // Filtered catalog list — re-fetches when filter changes.
  useEffect(() => {
    const t = setTimeout(() => {
      launchpadPublic
        .getCatalog(token, {
          source,
          category: category || undefined,
          q: search || undefined,
          minMargin: minMargin > 0 ? minMargin : undefined,
          limit: 100,
        })
        .then((r) => setItems(r.items))
        .catch((err) => setError(String(err)));
    }, 250);
    return () => clearTimeout(t);
  }, [token, source, category, search, minMargin]);

  const heroPicked = selections.find((s) => s.role === 'hero');
  const supportPicked = selections.filter((s) => s.role === 'support');
  const bundlePicked = selections.filter((s) => s.role === 'bundle');

  const expectedAov = useMemo(() => {
    const ids = new Set(selections.map((s) => s.catalogItemId));
    const matchedItems = items.filter((i) => ids.has(i.id));
    return matchedItems.reduce((acc, it) => {
      const sel = selections.find((s) => s.catalogItemId === it.id);
      const msrp = sel?.customMsrpUsd ?? it.msrpUsd ?? 0;
      return acc + msrp;
    }, 0);
  }, [selections, items]);

  // Selection set spans across pages — we keep selections as the source of
  // truth and find the catalog item lazily when we need to render its data.
  const setRole = (item: BmnCatalogItemDto, role: SkuRole | null) => {
    setSelections((prev) => {
      const without = prev.filter((s) => s.catalogItemId !== item.id);
      if (role === null) return without;
      // Hero is exclusive — picking a new hero demotes the prior hero to support
      if (role === 'hero') {
        return [
          ...without.map((s) => (s.role === 'hero' ? { ...s, role: 'support' as SkuRole } : s)),
          { catalogItemId: item.id, role },
        ];
      }
      return [...without, { catalogItemId: item.id, role }];
    });
  };

  const onSave = async () => {
    if (!heroPicked) {
      setError('Pick a hero SKU before saving.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await launchpadPublic.putSkus(
        token,
        selections.map((s, i) => ({
          catalogItemId: s.catalogItemId,
          role: s.role,
          customName: s.customName,
          customMsrpUsd: s.customMsrpUsd,
          displayOrder: i,
        })),
      );
      setSavedSkus(result.skus);
      onComplete?.();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const dirty = useMemo(() => {
    if (selections.length !== savedSkus.length) return true;
    const savedById = new Map(savedSkus.map((s) => [s.catalogItemId, s]));
    return selections.some((sel) => {
      const saved = savedById.get(sel.catalogItemId);
      return !saved || saved.role !== sel.role;
    });
  }, [selections, savedSkus]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Pick your products</h2>
        <p className="text-stone-400 mt-1.5">
          Choose 1 hero SKU + 1-2 supporting SKUs from the BMN catalog. Margin, MOQ, and compliance flags are shown for every option — pick economics that work.
        </p>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Field label="Catalog">
          <Select value={source} onChange={(e) => { setSource(e.target.value as CatalogSource); setCategory(''); }}>
            {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
        </Field>
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Min margin %">
          <Input type="number" min={0} max={100} value={minMargin} onChange={(e) => setMinMargin(parseFloat(e.target.value) || 0)} />
        </Field>
        <Field label="Search">
          <Input placeholder="Product or supplier" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
      </div>

      {/* Selection summary */}
      <div className="border border-stone-800 rounded p-4 bg-stone-950 grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
        <SummaryCell label="Hero" value={heroPicked ? itemLabel(items, heroPicked.catalogItemId) : 'Not picked'} highlight={!heroPicked} />
        <SummaryCell label="Support" value={`${supportPicked.length} picked`} />
        <SummaryCell label="Bundle" value={`${bundlePicked.length} picked`} />
        <SummaryCell label="Expected AOV" value={fmtUsd(expectedAov)} />
      </div>

      {/* Cards */}
      {loading ? (
        <div className="text-stone-500 text-sm">Loading catalog…</div>
      ) : items.length === 0 ? (
        <div className="text-stone-500 text-sm">No SKUs match these filters. Try widening the criteria.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map((item) => {
            const sel = selections.find((s) => s.catalogItemId === item.id);
            return <SkuCard key={item.id} item={item} role={sel?.role ?? null} setRole={(r) => setRole(item, r)} />;
          })}
        </div>
      )}

      {/* Save */}
      {error && <div className="text-sm text-red-400">{error}</div>}
      <div className="flex items-center gap-3 pt-2 border-t border-stone-800">
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !heroPicked || !dirty}
          className="px-5 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-stone-950 font-semibold rounded disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : dirty ? 'Save selections' : 'Saved ✓'}
        </button>
        <span className="text-xs text-stone-500">
          {!heroPicked ? 'Hero SKU required.' : dirty ? 'Unsaved changes.' : 'Saved — continue to the next step.'}
        </span>
      </div>
    </div>
  );
}

function SummaryCell({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-stone-500">{label}</div>
      <div className={`text-sm mt-0.5 ${highlight ? 'text-amber-300' : 'text-stone-100'}`}>{value}</div>
    </div>
  );
}

function itemLabel(items: BmnCatalogItemDto[], id: string): string {
  return items.find((i) => i.id === id)?.productName ?? '(saved on prior session)';
}

function SkuCard({ item, role, setRole }: { item: BmnCatalogItemDto; role: SkuRole | null; setRole: (r: SkuRole | null) => void }) {
  const ringColor =
    role === 'hero' ? 'border-cyan-500 ring-1 ring-cyan-500/40' :
    role === 'support' ? 'border-teal-700' :
    role === 'bundle' ? 'border-violet-700' :
    'border-stone-800';

  return (
    <div className={`border rounded p-4 bg-stone-950 ${ringColor}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0">
          <div className="text-stone-100 font-medium leading-tight truncate">{item.productName}</div>
          <div className="text-xs text-stone-500 mt-0.5">
            {item.supplierName ?? '—'}{item.category ? ` · ${item.category}` : ''}{item.sizeOrVolume ? ` · ${item.sizeOrVolume}` : ''}
          </div>
        </div>
        {item.requiresComplianceReview && (
          <span className="shrink-0 px-2 py-0.5 bg-amber-900/40 border border-amber-800 text-amber-200 text-[10px] uppercase tracking-wider rounded">
            Compliance
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1 text-[11px] text-stone-400 mb-3">
        <Stat label="MSRP" value={fmtUsd(item.msrpUsd)} />
        <Stat label="Margin" value={fmtPct(item.grossMarginPct)} />
        <Stat label="BMN net %" value={fmtPct(item.bmnNetPct)} />
        <Stat label="Cost" value={fmtUsd(item.totalLandedCost)} />
        <Stat label="MOQ" value={item.moq?.toString() ?? '—'} />
        <Stat label="Influencer 25%" value={fmtUsd(item.influencerPayout25Usd)} />
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <RoleButton current={role} role="hero" setRole={setRole} />
        <RoleButton current={role} role="support" setRole={setRole} />
        <RoleButton current={role} role="bundle" setRole={setRole} />
        {role && (
          <button
            type="button"
            onClick={() => setRole(null)}
            className="text-[11px] text-stone-500 hover:text-stone-300 ml-auto"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-stone-600">{label}</div>
      <div className="text-stone-200 text-xs">{value}</div>
    </div>
  );
}

function RoleButton({ current, role, setRole }: { current: SkuRole | null; role: SkuRole; setRole: (r: SkuRole) => void }) {
  const active = current === role;
  const cls =
    role === 'hero' ? (active ? 'bg-cyan-500 text-stone-950' : 'bg-stone-800 text-stone-300 hover:bg-stone-700') :
    role === 'support' ? (active ? 'bg-teal-700 text-white' : 'bg-stone-800 text-stone-300 hover:bg-stone-700') :
    /* bundle */ (active ? 'bg-violet-700 text-white' : 'bg-stone-800 text-stone-300 hover:bg-stone-700');
  const label = role === 'hero' ? 'Set as hero' : role === 'support' ? 'Add as support' : 'Add to bundle';
  return (
    <button type="button" onClick={() => setRole(role)} className={`text-[11px] px-2.5 py-1 rounded ${cls}`}>
      {active ? `${role[0].toUpperCase()}${role.slice(1)} ✓` : label}
    </button>
  );
}
