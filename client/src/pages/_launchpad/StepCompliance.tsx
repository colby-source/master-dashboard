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
import { StepHeader, Panel, PrimaryBtn } from './_primitives';

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

  if (loading) return (
    <div className="text-white/40 text-sm flex items-center gap-2">
      <span className="w-1.5 h-1.5 rounded-full bg-[#1AE7F6] animate-pulse" />
      Loading compliance review…
    </div>
  );
  if (error) return <div className="text-sm text-red-300">{error}</div>;

  return (
    <div className="space-y-6">
      <StepHeader
        step="06 / Compliance"
        title="Compliance review"
        subtitle="Before we generate your launch strategy, acknowledge how BMN handles compliance. Non-negotiable — protects you from FDA/FTC enforcement and keeps ad accounts alive."
      />

      {/* Universal gates — always apply */}
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] mb-3" style={{ color: 'rgba(26,231,246,0.6)' }}>
          Universal — applies to every BMN brand
        </h3>
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
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] mb-3" style={{ color: 'rgba(26,231,246,0.6)' }}>
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
        <div className="text-sm text-white/40 italic">
          None of the SKUs you picked are flagged for extra compliance review. Universal gates above still apply.
        </div>
      )}

      {/* Off-limits topics — show what creator declared */}
      {intake.off_limits_topics && intake.off_limits_topics.length > 0 && (
        <Panel>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/40 mb-2.5">
            Your declared off-limits topics
          </div>
          <div className="flex flex-wrap gap-2">
            {intake.off_limits_topics.map((t, i) => (
              <span
                key={i}
                className="px-3 py-1 text-xs rounded-full"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  color: 'rgba(255,255,255,0.7)',
                }}
              >
                {t}
              </span>
            ))}
          </div>
          <p className="text-xs text-white/35 mt-3 leading-relaxed">
            Strategy generation will avoid these topics in your content calendar. Edit them on the Voice step if needed.
          </p>
        </Panel>
      )}

      {/* Continue */}
      <div className="flex items-center gap-3 pt-4 border-t border-white/[0.06]">
        <PrimaryBtn onClick={() => onComplete?.()} disabled={!allAcked}>
          Continue →
        </PrimaryBtn>
        <span className="text-xs text-white/40">
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
    <div
      className="rounded-2xl p-5 transition-all duration-200"
      style={
        acked
          ? { border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.04)' }
          : { border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.025)' }
      }
    >
      <div className="flex items-start gap-3.5">
        <button
          type="button"
          onClick={() => (acked ? onUnack() : onAck())}
          aria-label={acked ? 'Unacknowledge' : 'Acknowledge'}
          className="shrink-0 mt-0.5 h-5 w-5 rounded-md flex items-center justify-center text-xs font-bold transition-all duration-200"
          style={
            acked
              ? { background: 'rgb(16,185,129)', color: '#0D0D0D', boxShadow: '0 0 10px rgba(16,185,129,0.4)' }
              : { background: 'transparent', border: '1.5px solid rgba(255,255,255,0.25)' }
          }
        >
          {acked ? '✓' : ''}
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-white font-semibold">{title}</div>
          {meta && <div className="text-xs text-white/40 mt-1">{meta}</div>}
          <div className="text-sm text-white/55 mt-2 leading-relaxed">{detail}</div>
          {acked && (
            <div className="text-[11px] mt-2.5" style={{ color: 'rgb(110,231,183)' }}>
              Acknowledged {new Date(ackedAt!).toLocaleString()}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
