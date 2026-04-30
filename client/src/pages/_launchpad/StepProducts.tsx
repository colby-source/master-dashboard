/**
 * Wizard Step 5 — Product line + SKUs.
 *
 * Two modes, based on whether the brand already has SKUs picked when the
 * creator opens the wizard:
 *
 *   REVIEW MODE (default when savedSkus.length > 0):
 *     The BMN team typically pre-loads SKUs via the admin tool before
 *     sending the magic link. The creator sees "here's what we built for
 *     you" with full economics + compliance flags, and a single primary
 *     "Looks good" CTA. They can drop into edit mode if they want to
 *     change anything.
 *
 *   PICKER MODE (when no saved SKUs OR creator clicks "Edit"):
 *     The full PLDS catalog browser with filters + role assignment for
 *     hero / support / bundle. Heroes are exclusive — picking a new hero
 *     auto-demotes the previous one to support.
 *
 * PUTting selections wholesale keeps the data model dead simple — the
 * server snapshots whatever the UI sent at submission time.
 */

import { useEffect, useMemo, useState } from 'react';
import { launchpadPublic } from '../../lib/api/launchpad';
import type { BmnCatalogItemDto, BrandSkuDto, CatalogSource } from '../../lib/api/launchpad';
import { Field, Input, Select } from './_primitives';
import { fmtUsd, fmtPct } from './_format';

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
  const [savedItems, setSavedItems] = useState<Map<string, BmnCatalogItemDto>>(new Map());
  const [mode, setMode] = useState<'review' | 'edit'>('edit');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial: load categories for the active source + saved selections.
  // If saved selections already exist (admin pre-loaded them), default to
  // REVIEW mode so the creator confirms instead of re-picking.
  useEffect(() => {
    setLoading(true);
    Promise.all([
      launchpadPublic.getCatalogCategories(token, source),
      launchpadPublic.getSkus(token),
    ])
      .then(async ([cats, skus]) => {
        setCategories(cats.categories);
        setSavedSkus(skus.skus);
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
        // Default to review mode when SKUs are pre-loaded
        if (skus.skus.length > 0) {
          setMode('review');
          // Hydrate full catalog metadata for the review cards (one bulk pull,
          // typical brand has 3-5 SKUs so we just grab the first 500 items).
          const allItems = await launchpadPublic.getCatalog(token, { limit: 500 });
          const map = new Map<string, BmnCatalogItemDto>();
          for (const it of allItems.items) map.set(it.id, it);
          setSavedItems(map);
        } else {
          setMode('edit');
        }
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
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

  // ── REVIEW MODE: BMN team pre-loaded SKUs; creator just confirms ──
  if (mode === 'review' && savedSkus.length > 0) {
    return (
      <ReviewMode
        skus={savedSkus}
        items={savedItems}
        onEdit={() => setMode('edit')}
        onContinue={() => onComplete?.()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Pick your products</h2>
          <p className="text-stone-400 mt-1.5">
            Choose 1 hero SKU + 1-2 supporting SKUs from the BMN catalog. Margin, MOQ, and compliance flags are shown for every option — pick economics that work.
          </p>
        </div>
        {savedSkus.length > 0 && (
          <button
            type="button"
            onClick={() => setMode('review')}
            className="shrink-0 text-xs text-stone-400 hover:text-stone-200 underline mt-2"
          >
            Back to review
          </button>
        )}
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

// ── REVIEW MODE — BMN team pre-loaded SKUs; creator just confirms ──

function ReviewMode({
  skus, items, onEdit, onContinue,
}: {
  skus: BrandSkuDto[];
  items: Map<string, BmnCatalogItemDto>;
  onEdit: () => void;
  onContinue: () => void;
}) {
  const hero = skus.find((s) => s.role === 'hero');
  const support = skus.filter((s) => s.role === 'support');
  const bundle = skus.filter((s) => s.role === 'bundle');

  const expectedAov = skus.reduce((acc, sku) => {
    const item = items.get(sku.catalogItemId);
    const msrp = sku.customMsrpUsd ?? item?.msrpUsd ?? 0;
    return acc + msrp;
  }, 0);

  const flagged = skus.filter((s) => items.get(s.catalogItemId)?.requiresComplianceReview);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Your products</h2>
        <p className="text-stone-400 mt-1.5">
          Here's what BMN built for your brand. Review the picks below — economics, MOQ, and compliance flags. If anything needs to change, click <span className="text-stone-200">Edit selections</span> to swap SKUs or change roles.
        </p>
      </div>

      <div className="border border-stone-800 rounded p-4 bg-stone-950 grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
        <SummaryCellLite label="Hero" value={hero ? labelFor(items, hero) : 'Not set'} highlight={!hero} />
        <SummaryCellLite label="Support" value={`${support.length} SKU${support.length === 1 ? '' : 's'}`} />
        <SummaryCellLite label="Bundle" value={`${bundle.length} SKU${bundle.length === 1 ? '' : 's'}`} />
        <SummaryCellLite label="Expected AOV" value={fmtUsd(expectedAov)} />
      </div>

      {flagged.length > 0 && (
        <div className="border border-amber-900/50 bg-amber-950/20 rounded p-3 text-sm">
          <span className="text-amber-300 font-medium">{flagged.length} of these SKU{flagged.length === 1 ? '' : 's'} need extra compliance review.</span>
          <span className="text-stone-300"> You'll handle that on the next step.</span>
        </div>
      )}

      <div className="space-y-3">
        {[...skus].sort((a, b) => roleOrder(a.role) - roleOrder(b.role)).map((sku) => {
          const item = items.get(sku.catalogItemId);
          if (!item) return (
            <div key={sku.id} className="border border-stone-800 rounded p-4 bg-stone-950 text-stone-500 text-sm">
              Unknown SKU {sku.catalogItemId} (catalog metadata not loaded)
            </div>
          );
          const ringColor =
            sku.role === 'hero' ? 'border-cyan-500/40 ring-1 ring-cyan-500/20' :
            sku.role === 'support' ? 'border-teal-700/50' :
            'border-violet-700/50';
          return (
            <div key={sku.id} className={`border rounded p-4 bg-stone-950 ${ringColor}`}>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ${
                      sku.role === 'hero' ? 'bg-cyan-500 text-stone-950' :
                      sku.role === 'support' ? 'bg-teal-700 text-white' :
                      'bg-violet-700 text-white'
                    }`}>
                      {sku.role}
                    </span>
                    {item.requiresComplianceReview && (
                      <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 bg-amber-900/40 border border-amber-800 text-amber-200 rounded">
                        Compliance
                      </span>
                    )}
                  </div>
                  <div className="text-stone-100 font-medium">{sku.customName ?? item.productName}</div>
                  <div className="text-xs text-stone-500 mt-0.5">
                    {item.supplierName ?? '—'}{item.category ? ` · ${item.category}` : ''}{item.sizeOrVolume ? ` · ${item.sizeOrVolume}` : ''}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-[11px] text-stone-400">
                <Stat label="MSRP" value={fmtUsd(sku.customMsrpUsd ?? item.msrpUsd)} />
                <Stat label="Cost" value={fmtUsd(item.totalLandedCost)} />
                <Stat label="Margin" value={fmtPct(item.grossMarginPct)} />
                <Stat label="BMN net %" value={fmtPct(item.bmnNetPct)} />
                <Stat label="MOQ" value={item.moq?.toString() ?? '—'} />
                <Stat label="Influencer 25%" value={fmtUsd(item.influencerPayout25Usd)} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3 pt-2 border-t border-stone-800">
        <button
          type="button"
          onClick={onContinue}
          className="px-5 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-stone-950 font-semibold rounded"
        >
          Looks good — continue
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="px-4 py-2 text-sm bg-stone-800 hover:bg-stone-700 text-stone-200 rounded"
        >
          Edit selections
        </button>
      </div>
    </div>
  );
}

function SummaryCellLite({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-stone-500">{label}</div>
      <div className={`text-sm mt-0.5 ${highlight ? 'text-amber-300' : 'text-stone-100'}`}>{value}</div>
    </div>
  );
}

function labelFor(items: Map<string, BmnCatalogItemDto>, sku: BrandSkuDto): string {
  return sku.customName ?? items.get(sku.catalogItemId)?.productName ?? '(unknown)';
}

function roleOrder(role: string): number {
  return role === 'hero' ? 0 : role === 'support' ? 1 : 2;
}
