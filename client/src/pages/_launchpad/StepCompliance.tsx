/**
 * Wizard Step 6 — Compliance review.
 *
 * For every SKU the creator picked in Step 5 that has
 * requires_compliance_review = true, surface a checklist of what they
 * MUST acknowledge before launch. Acks are stored on the intake JSON
 * (no new schema for now): intake.compliance_acks = { [skuId]: ISO date }.
 *
 * Phase 6 (Guarantee Gates) will upgrade this to a real audit trail
 * with reviewer attribution + per-claim sign-off.
 *
 * Universal gates that ALWAYS apply (regardless of category):
 *  - No disease claims on any supplement
 *  - All paid ads pre-reviewed by BMN legal
 *  - FTC endorsement disclosure on every paid creator post
 *
 * Per-SKU gates fire when requires_compliance_review = true.
 */

import { useEffect, useMemo, useState } from 'react';
import { launchpadPublic } from '../../lib/api/launchpad';
import type { BmnCatalogItemDto, BrandSkuDto } from '../../lib/api/launchpad';
import type { IntakeData, IntakePatch } from './_types';

interface Props {
  token: string;
  intake: IntakeData;
  update: (patch: IntakePatch) => void;
  onComplete?: () => void;
}

const UNIVERSAL_GATES = [
  {
    id: 'no_disease_claims',
    title: 'No disease claims on any supplement',
    detail: 'Supplements cannot claim to "treat", "cure", "prevent" or "diagnose" any condition. All copy stays in structure/function language ("supports", "promotes", "helps maintain"). BMN legal reviews every PDP and ad before publishing.',
  },
  {
    id: 'ftc_disclosure',
    title: 'FTC endorsement disclosure on every paid creator post',
    detail: 'Every paid creator who promotes the brand must disclose the material connection per FTC 16 CFR Part 255. #ad or #sponsored at the start of the caption (not buried). Spoken disclosure on video before the recommendation.',
  },
  {
    id: 'pre_publish_legal_review',
    title: 'BMN legal pre-reviews every PDP, ad, and email subject line',
    detail: 'Before any product page goes live, ad campaign launches, or email sends to a paid list, BMN legal signs off. Auto-replies do not bypass this — every customer-facing claim is reviewed.',
  },
];

export function StepCompliance({ token, intake, update, onComplete }: Props) {
  const [skus, setSkus] = useState<BrandSkuDto[]>([]);
  const [catalog, setCatalog] = useState<Map<string, BmnCatalogItemDto>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    launchpadPublic
      .getSkus(token)
      .then(async (r) => {
        if (cancelled) return;
        // Hydrate the catalog for the picked SKU IDs only (one query per source
        // would be cleaner; for the typical 3-5 picks a getById-by-id sweep is
        // a non-issue. We just pull the catalog with high limit and filter.)
        const cat = await launchpadPublic.getCatalog(token, { limit: 500 });
        if (cancelled) return;
        const map = new Map<string, BmnCatalogItemDto>();
        for (const item of cat.items) map.set(item.id, item);
        setSkus(r.skus);
        setCatalog(map);
      })
      .catch((err) => { if (!cancelled) setError(String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  const acks: Record<string, string> = intake.compliance_acks || {};

  const flaggedSkus = useMemo(() => {
    return skus
      .map((sku) => ({ sku, item: catalog.get(sku.catalogItemId) }))
      .filter(({ item }) => item?.requiresComplianceReview);
  }, [skus, catalog]);

  const universalAcked = UNIVERSAL_GATES.every((g) => acks[g.id]);
  const perSkuAcked = flaggedSkus.every(({ sku }) => acks[`sku:${sku.id}`]);
  const allAcked = universalAcked && perSkuAcked;

  const ack = (key: string) => {
    update({
      compliance_acks: {
        ...(acks || {}),
        [key]: new Date().toISOString(),
      },
    });
  };

  const unack = (key: string) => {
    const next = { ...(acks || {}) };
    delete next[key];
    update({ compliance_acks: next });
  };

  if (loading) return <div className="text-stone-500 text-sm">Loading compliance review…</div>;
  if (error) return <div className="text-sm text-red-400">{error}</div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Compliance review</h2>
        <p className="text-stone-400 mt-1.5">
          Before we generate your launch strategy, you need to acknowledge how BMN handles compliance for the SKUs you picked. These rules are non-negotiable — they protect your brand from FDA / FTC enforcement actions and keep your ad accounts alive.
        </p>
      </div>

      {/* Universal gates — always apply */}
      <section>
        <h3 className="text-xs uppercase tracking-wider text-stone-500 mb-3">Universal — applies to every BMN brand</h3>
        <div className="space-y-2">
          {UNIVERSAL_GATES.map((gate) => (
            <AckRow
              key={gate.id}
              ackedAt={acks[gate.id]}
              onAck={() => ack(gate.id)}
              onUnack={() => unack(gate.id)}
              title={gate.title}
              detail={gate.detail}
            />
          ))}
        </div>
      </section>

      {/* Per-SKU gates */}
      {flaggedSkus.length > 0 && (
        <section>
          <h3 className="text-xs uppercase tracking-wider text-stone-500 mb-3">
            Per-SKU — {flaggedSkus.length} of your selections need extra acknowledgment
          </h3>
          <div className="space-y-2">
            {flaggedSkus.map(({ sku, item }) => (
              <AckRow
                key={sku.id}
                ackedAt={acks[`sku:${sku.id}`]}
                onAck={() => ack(`sku:${sku.id}`)}
                onUnack={() => unack(`sku:${sku.id}`)}
                title={`${item?.productName ?? sku.catalogItemId}`}
                detail={item?.complianceNotes ?? 'Requires BMN legal pre-review of all marketing copy and product claims before publishing.'}
                meta={`${item?.supplierName ?? '—'} · ${item?.category ?? ''} · role: ${sku.role}`}
              />
            ))}
          </div>
        </section>
      )}

      {flaggedSkus.length === 0 && (
        <div className="text-sm text-stone-500 italic">
          None of the SKUs you picked are flagged for extra compliance review. Universal gates above still apply.
        </div>
      )}

      {/* Off-limits topics — show what creator declared */}
      {intake.off_limits_topics && intake.off_limits_topics.length > 0 && (
        <section className="border border-stone-800 rounded p-4 bg-stone-950">
          <div className="text-xs uppercase tracking-wider text-stone-500 mb-2">Your declared off-limits topics</div>
          <div className="flex flex-wrap gap-1.5">
            {intake.off_limits_topics.map((t, i) => (
              <span key={i} className="px-2 py-0.5 bg-stone-800 text-stone-300 text-xs rounded">{t}</span>
            ))}
          </div>
          <p className="text-xs text-stone-500 mt-2">
            Strategy generation will avoid these topics in your content calendar. Edit them on the Voice step if needed.
          </p>
        </section>
      )}

      {/* Continue */}
      <div className="flex items-center gap-3 pt-3 border-t border-stone-800">
        <button
          type="button"
          onClick={() => onComplete?.()}
          disabled={!allAcked}
          className="px-5 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-stone-950 font-semibold rounded disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Continue
        </button>
        <span className="text-xs text-stone-500">
          {allAcked
            ? `All ${UNIVERSAL_GATES.length + flaggedSkus.length} acknowledgments complete.`
            : `${UNIVERSAL_GATES.length + flaggedSkus.length - Object.keys(acks).filter((k) => UNIVERSAL_GATES.some((g) => g.id === k) || k.startsWith('sku:')).length} acknowledgments pending.`}
        </span>
      </div>
    </div>
  );
}

function AckRow({
  ackedAt, onAck, onUnack, title, detail, meta,
}: {
  ackedAt?: string;
  onAck: () => void;
  onUnack: () => void;
  title: string;
  detail: string;
  meta?: string;
}) {
  const acked = !!ackedAt;
  return (
    <div className={`border rounded p-4 ${acked ? 'border-emerald-900 bg-emerald-950/30' : 'border-stone-800 bg-stone-950'}`}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => (acked ? onUnack() : onAck())}
          aria-label={acked ? 'Unacknowledge' : 'Acknowledge'}
          className={`shrink-0 mt-0.5 h-5 w-5 border-2 rounded ${
            acked
              ? 'bg-emerald-500 border-emerald-500 text-stone-950'
              : 'border-stone-600 hover:border-stone-400'
          } flex items-center justify-center text-xs font-bold`}
        >
          {acked ? '✓' : ''}
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-stone-100 font-medium">{title}</div>
          {meta && <div className="text-xs text-stone-500 mt-0.5">{meta}</div>}
          <div className="text-sm text-stone-400 mt-1.5 leading-relaxed">{detail}</div>
          {acked && (
            <div className="text-[11px] text-emerald-400 mt-2">
              Acknowledged {new Date(ackedAt!).toLocaleString()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
