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
import { Field, Input, Select, StepHeader, Panel, PrimaryBtn } from './_primitives';
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
        <StepHeader
          step="05 / Products"
          title="Pick your products"
          subtitle="Choose 1 hero SKU + 1–2 supporting SKUs from the BMN catalog. Margin, MOQ, and compliance flags shown — pick economics that work."
        />
        {savedSkus.length > 0 && (
          <button
            type="button"
            onClick={() => setMode('review')}
            className="shrink-0 text-xs text-slate-500 hover:text-slate-900 underline mt-2 transition-colors"
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
      <Panel className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
        <SummaryCell label="Hero" value={heroPicked ? itemLabel(items, heroPicked.catalogItemId) : 'Not picked'} highlight={!heroPicked} />
        <SummaryCell label="Support" value={`${supportPicked.length} picked`} />
        <SummaryCell label="Bundle" value={`${bundlePicked.length} picked`} />
        <SummaryCell label="Expected AOV" value={fmtUsd(expectedAov)} />
      </Panel>

      {/* Cards */}
      {loading ? (
        <div className="text-slate-500 text-sm flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#0A9396] animate-pulse" />
          Loading catalog…
        </div>
      ) : items.length === 0 ? (
        <div className="text-slate-500 text-sm">No SKUs match these filters. Try widening the criteria.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map((item) => {
            const sel = selections.find((s) => s.catalogItemId === item.id);
            return <SkuCard key={item.id} item={item} role={sel?.role ?? null} setRole={(r) => setRole(item, r)} />;
          })}
        </div>
      )}

      {/* Save */}
      {error && <div className="text-sm text-rose-600">{error}</div>}
      <div className="flex items-center gap-3 pt-4 border-t border-slate-200">
        <PrimaryBtn onClick={onSave} disabled={saving || !heroPicked || !dirty}>
          {saving ? 'Saving…' : dirty ? 'Save selections' : 'Saved ✓'}
        </PrimaryBtn>
        <span className="text-xs text-slate-500">
          {!heroPicked ? 'Hero SKU required.' : dirty ? 'Unsaved changes.' : 'Saved — continue to the next step.'}
        </span>
      </div>
    </div>
  );
}

function SummaryCell({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className={`text-sm mt-1 ${highlight ? 'text-amber-700' : 'text-slate-900'}`}>{value}</div>
    </div>
  );
}

function itemLabel(items: BmnCatalogItemDto[], id: string): string {
  return items.find((i) => i.id === id)?.productName ?? '(saved on prior session)';
}

function SkuCard({ item, role, setRole }: { item: BmnCatalogItemDto; role: SkuRole | null; setRole: (r: SkuRole | null) => void }) {
  const cardStyle = (() => {
    if (role === 'hero')    return { border: 'rgba(10,147,150,0.55)',  bg: 'rgba(26,231,246,0.06)', shadow: '0 6px 20px rgba(10,147,150,0.14)' };
    if (role === 'support') return { border: 'rgba(10,147,150,0.40)',  bg: 'rgba(148,210,189,0.14)', shadow: 'none' };
    if (role === 'bundle')  return { border: 'rgba(168,85,247,0.45)',  bg: 'rgba(168,85,247,0.06)', shadow: 'none' };
    return { border: '#E2E8F0', bg: '#FFFFFF', shadow: '0 1px 2px rgba(15,23,42,0.04)' };
  })();

  return (
    <div
      className="rounded-2xl p-5 transition-all duration-200"
      style={{ border: `1px solid ${cardStyle.border}`, background: cardStyle.bg, boxShadow: cardStyle.shadow }}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <div className="text-slate-900 font-semibold leading-tight truncate">{item.productName}</div>
          <div className="text-xs text-slate-500 mt-1">
            {item.supplierName ?? '—'}{item.category ? ` · ${item.category}` : ''}{item.sizeOrVolume ? ` · ${item.sizeOrVolume}` : ''}
          </div>
        </div>
        {item.requiresComplianceReview && (
          <span
            className="shrink-0 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full"
            style={{ background: 'rgba(245,158,11,0.14)', color: 'rgb(146,64,14)', border: '1px solid rgba(245,158,11,0.40)' }}
          >
            Compliance
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1.5 mb-4">
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
            className="text-[11px] text-slate-500 hover:text-slate-900 ml-auto transition-colors"
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
      <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className="text-slate-800 text-xs mt-0.5">{value}</div>
    </div>
  );
}

function RoleButton({ current, role, setRole }: { current: SkuRole | null; role: SkuRole; setRole: (r: SkuRole) => void }) {
  const active = current === role;
  const activeStyle = (() => {
    if (role === 'hero')    return { background: 'linear-gradient(135deg,#1AE7F6,#0A9396)', color: '#06292B' };
    if (role === 'support') return { background: '#0A9396',                                  color: '#fff'    };
    return                       { background: 'rgb(124,58,237)',                            color: '#fff'    };
  })();
  const label = role === 'hero' ? 'Set as hero' : role === 'support' ? 'Add as support' : 'Add to bundle';
  return (
    <button
      type="button"
      onClick={() => setRole(role)}
      className="text-[11px] font-semibold px-3 py-1.5 rounded-full transition-all duration-200 hover:scale-[1.04]"
      style={
        active
          ? activeStyle
          : { background: '#FFFFFF', border: '1px solid #E2E8F0', color: '#334155' }
      }
    >
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
      <StepHeader
        step="05 / Products"
        title="Your products"
        subtitle="Here's what BMN built for your brand. Review the picks below. If anything needs to change, click Edit selections."
      />

      <Panel className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-sm">
        <SummaryCellLite label="Hero" value={hero ? labelFor(items, hero) : 'Not set'} highlight={!hero} />
        <SummaryCellLite label="Support" value={`${support.length} SKU${support.length === 1 ? '' : 's'}`} />
        <SummaryCellLite label="Bundle" value={`${bundle.length} SKU${bundle.length === 1 ? '' : 's'}`} />
        <SummaryCellLite label="Expected AOV" value={fmtUsd(expectedAov)} />
      </Panel>

      {flagged.length > 0 && (
        <Panel className="border-amber-300 bg-amber-50">
          <span className="text-amber-800 font-semibold text-sm">
            {flagged.length} of these SKU{flagged.length === 1 ? '' : 's'} need extra compliance review.
          </span>
          <span className="text-slate-700 text-sm"> You'll handle that on the next step.</span>
        </Panel>
      )}

      <div className="space-y-3">
        {[...skus].sort((a, b) => roleOrder(a.role) - roleOrder(b.role)).map((sku) => {
          const item = items.get(sku.catalogItemId);
          if (!item) return (
            <Panel key={sku.id} className="text-slate-500 text-sm">
              Unknown SKU {sku.catalogItemId} (catalog metadata not loaded)
            </Panel>
          );
          const cardStyle = (() => {
            if (sku.role === 'hero')    return { border: 'rgba(10,147,150,0.45)', bg: 'rgba(26,231,246,0.06)', shadow: '0 6px 20px rgba(10,147,150,0.10)' };
            if (sku.role === 'support') return { border: 'rgba(10,147,150,0.35)', bg: 'rgba(148,210,189,0.14)',  shadow: 'none' };
            return                           { border: 'rgba(168,85,247,0.40)', bg: 'rgba(168,85,247,0.05)',  shadow: 'none' };
          })();
          const rolePillStyle = (() => {
            if (sku.role === 'hero')    return { background: 'linear-gradient(135deg,#1AE7F6,#0A9396)', color: '#06292B' };
            if (sku.role === 'support') return { background: '#0A9396',                                  color: '#fff'    };
            return                           { background: 'rgb(124,58,237)',                            color: '#fff'    };
          })();
          return (
            <div
              key={sku.id}
              className="rounded-2xl p-5"
              style={{ border: `1px solid ${cardStyle.border}`, background: cardStyle.bg, boxShadow: cardStyle.shadow }}
            >
              <div className="flex items-start justify-between gap-3 mb-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className="text-[10px] font-bold uppercase tracking-[0.14em] px-2.5 py-0.5 rounded-full"
                      style={rolePillStyle}
                    >
                      {sku.role}
                    </span>
                    {item.requiresComplianceReview && (
                      <span
                        className="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-0.5 rounded-full"
                        style={{ background: 'rgba(245,158,11,0.14)', color: 'rgb(146,64,14)', border: '1px solid rgba(245,158,11,0.40)' }}
                      >
                        Compliance
                      </span>
                    )}
                  </div>
                  <div className="text-slate-900 font-semibold">{sku.customName ?? item.productName}</div>
                  <div className="text-xs text-slate-500 mt-1">
                    {item.supplierName ?? '—'}{item.category ? ` · ${item.category}` : ''}{item.sizeOrVolume ? ` · ${item.sizeOrVolume}` : ''}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
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

      <div className="flex items-center gap-3 pt-4 border-t border-slate-200">
        <PrimaryBtn onClick={onContinue}>Looks good — continue →</PrimaryBtn>
        <button
          type="button"
          onClick={onEdit}
          className="px-4 py-2 text-sm font-medium bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-full text-slate-700 hover:text-slate-900 transition-all duration-200"
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
      <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className={`text-sm mt-1 ${highlight ? 'text-amber-700' : 'text-slate-900'}`}>{value}</div>
    </div>
  );
}

function labelFor(items: Map<string, BmnCatalogItemDto>, sku: BrandSkuDto): string {
  return sku.customName ?? items.get(sku.catalogItemId)?.productName ?? '(unknown)';
}

function roleOrder(role: string): number {
  return role === 'hero' ? 0 : role === 'support' ? 1 : 2;
}
