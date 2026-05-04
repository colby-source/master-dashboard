/**
 * StepAssetsReview — Read-only asset preview for pre-baked brands.
 *
 * Shown INSTEAD of the standard StepAssets upload step when the admin has
 * pre-loaded brand assets (logo, product photos, founder photos, brand guide)
 * before sending the magic link.
 *
 * The creator:
 *   1. Sees all pre-uploaded assets grouped by type
 *   2. Can leave a comment on the full asset collection
 *   3. Approves assets with one click (stored in review_signoffs.assets)
 *
 * If the creator needs to add their own supplemental assets, they can still
 * upload via the "+ Upload more" action per group.
 */

import { useCallback, useEffect, useState } from 'react';
import { launchpadPublic } from '../../lib/api/launchpad';
import type { IntakeData, IntakePatch } from './_types';
import { StepHeader, Panel, PrimaryBtn, Textarea } from './_primitives';

interface AssetRow {
  id: string;
  asset_type: string;
  filename: string;
  drive_file_url: string;
  uploaded_at: string;
}

interface Props {
  token: string;
  intake: IntakeData;
  update: (patch: IntakePatch) => void;
}

const ASSET_TYPE_LABELS: Record<string, string> = {
  logo: 'Logo',
  product_photo: 'Product photos',
  founder_photo: 'Founder photos',
  brand_guide: 'Brand guide',
  finalized_post: 'Finalized posts',
  video: 'Videos',
  other: 'Other assets',
};

// Asset types shown in review order
const ASSET_TYPE_ORDER = ['logo', 'brand_guide', 'founder_photo', 'product_photo', 'finalized_post', 'video', 'other'];

export function StepAssetsReview({ token, intake, update }: Props) {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [commentOpen, setCommentOpen] = useState(false);

  const signedOff = !!(intake.review_signoffs?.assets);
  const feedback: Record<string, string> = (intake.creator_feedback as Record<string, string>) || {};
  const assetComment = feedback['assets'] || '';

  const refresh = useCallback(() => {
    launchpadPublic.listAssets(token)
      .then((r) => setAssets(r.assets as AssetRow[]))
      .catch(() => { /* non-critical */ });
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    launchpadPublic.listAssets(token)
      .then((r) => { if (!cancelled) setAssets(r.assets as AssetRow[]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  const saveComment = (text: string) => {
    const next = { ...feedback, assets: text };
    update({ creator_feedback: next });
  };

  const approve = () => {
    update({
      review_signoffs: {
        ...(intake.review_signoffs || {}),
        assets: new Date().toISOString(),
      },
    });
  };

  const onUploadMore = async (e: React.ChangeEvent<HTMLInputElement>, assetType: string) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of Array.from(files)) {
        await launchpadPublic.uploadAsset(token, file, assetType);
      }
      refresh();
    } catch (err) {
      setUploadError(String(err));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  // Group assets by type
  const grouped: Record<string, AssetRow[]> = {};
  for (const asset of assets) {
    const key = asset.asset_type in ASSET_TYPE_LABELS ? asset.asset_type : 'other';
    grouped[key] = [...(grouped[key] || []), asset];
  }

  const orderedTypes = ASSET_TYPE_ORDER.filter((t) => (grouped[t] || []).length > 0);

  if (loading) {
    return (
      <div className="text-slate-500 text-sm flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-[#0A9396] animate-pulse" />
        Loading brand assets…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StepHeader
        step="Brand assets review"
        title="Your brand assets"
        subtitle="BMN has uploaded your brand assets. Review them below and approve to continue. You can also add supplemental assets if needed."
      />

      {/* BRAND DIRECTION badge */}
      <div
        className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[11px] font-bold uppercase tracking-widest"
        style={{
          background: 'rgba(26,231,246,0.12)',
          border: '1px solid rgba(10,147,150,0.35)',
          color: '#016F74',
        }}
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#0A9396' }} />
        Brand direction — built by BMN
      </div>

      {assets.length === 0 ? (
        <Panel>
          <p className="text-slate-500 text-sm italic">No assets uploaded by BMN yet. Your launch manager will add them shortly.</p>
        </Panel>
      ) : (
        <div className="space-y-4">
          {orderedTypes.map((assetType) => {
            const typeAssets = grouped[assetType] || [];
            const label = ASSET_TYPE_LABELS[assetType] || assetType;
            return (
              <Panel key={assetType}>
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div>
                    <div className="font-semibold text-slate-900">{label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{typeAssets.length} file{typeAssets.length === 1 ? '' : 's'}</div>
                  </div>
                  {/* Allow creator to add supplemental uploads */}
                  <label className="cursor-pointer px-3 py-1.5 text-[11px] font-medium bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-full text-slate-700 hover:text-slate-900 transition-all duration-200 whitespace-nowrap">
                    {uploading ? 'Uploading…' : '+ Upload more'}
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => onUploadMore(e, assetType)}
                      disabled={uploading}
                    />
                  </label>
                </div>

                <div className="flex flex-wrap gap-2">
                  {typeAssets.map((asset) => (
                    <a
                      key={asset.id}
                      href={asset.drive_file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full transition-all duration-200 hover:scale-[1.02]"
                      style={{
                        background: 'rgba(26,231,246,0.12)',
                        border: '1px solid rgba(10,147,150,0.35)',
                        color: '#016F74',
                      }}
                    >
                      <AssetIcon filename={asset.filename} />
                      {asset.filename}
                    </a>
                  ))}
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      {uploadError && (
        <Panel className="border-rose-300 bg-rose-50">
          <p className="text-sm text-rose-700">{uploadError}</p>
        </Panel>
      )}

      {/* Comment section */}
      <Panel className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-700">
            Comment on assets
          </div>
          <button
            type="button"
            onClick={() => setCommentOpen((prev) => !prev)}
            className="text-[11px] font-medium transition-colors"
            style={{ color: '#0A9396' }}
          >
            {commentOpen ? 'Hide' : (assetComment ? 'Edit comment' : '+ Add comment')}
          </button>
        </div>

        {assetComment && !commentOpen && (
          <p className="text-sm text-slate-600 italic">{assetComment}</p>
        )}

        {commentOpen && (
          <Textarea
            rows={3}
            placeholder="Any feedback on the assets? (e.g. wrong logo version, need more angles)"
            value={assetComment}
            onChange={(e) => saveComment(e.target.value)}
          />
        )}
      </Panel>

      {/* Approve */}
      <div className="pt-4 border-t border-slate-200">
        {signedOff ? (
          <div className="flex items-center gap-3 text-sm">
            <span
              className="w-5 h-5 rounded-md flex items-center justify-center text-xs font-bold"
              style={{ background: 'rgb(16,185,129)', color: '#fff' }}
            >
              ✓
            </span>
            <span className="text-slate-700">
              Assets approved{' '}
              <span className="text-slate-500">
                {new Date(intake.review_signoffs!.assets!).toLocaleString()}
              </span>
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            <PrimaryBtn onClick={approve} disabled={assets.length === 0}>
              Approve assets →
            </PrimaryBtn>
            <span className="text-xs text-slate-500">
              {assets.length === 0 ? 'Waiting for BMN to upload assets.' : 'Assets look good? Approve to continue.'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function AssetIcon({ filename }: { filename: string }) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return <span>img</span>;
  if (['mp4', 'mov', 'avi', 'mkv'].includes(ext)) return <span>vid</span>;
  if (['pdf'].includes(ext)) return <span>pdf</span>;
  return <span>file</span>;
}
