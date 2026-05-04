import { useEffect, useState, useCallback } from 'react';
import { launchpadPublic } from '../../lib/api/launchpad';
import { StepHeader, Panel } from './_primitives';
import type { Session } from './_types';

interface AssetRow {
  id: string;
  asset_type: string;
  filename: string;
  drive_file_url: string;
}

const ASSET_TYPES: Array<{ value: string; label: string; hint: string }> = [
  { value: 'logo',           label: 'Logo',                   hint: 'PNG with transparency, plus a 1:1 social variant' },
  { value: 'product_photo',  label: 'Product photos',         hint: 'Min 5 — front, hand-held, lifestyle' },
  { value: 'founder_photo',  label: 'Founder photos',         hint: 'For about / story content' },
  { value: 'brand_guide',    label: 'Brand guide',            hint: 'PDF or any reference doc' },
  { value: 'finalized_post', label: 'Finalized posts',        hint: 'Visuals + captions per the 30-day calendar' },
  { value: 'video',          label: 'Videos / reels',         hint: 'Raw or edited' },
];

export function StepAssets({ token, session }: { token: string; session: Session }) {
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    launchpadPublic.listAssets(token).then((r) => setAssets(r.assets as AssetRow[]));
  }, [token]);

  useEffect(() => { refresh(); }, [refresh]);

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>, assetType: string) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        await launchpadPublic.uploadAsset(token, file, assetType);
      }
      refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-6">
      <StepHeader
        step="11 / Assets"
        title="Upload your finalized assets"
        subtitle="Everything we need to ship the 30-day sprint. All uploads land in your private Google Drive folder."
      />

      {session.driveFolderUrl && (
        <a
          href={session.driveFolderUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-sm font-medium transition-colors"
          style={{ color: '#1AE7F6' }}
        >
          Open my Drive folder ↗
        </a>
      )}

      {error && (
        <Panel className="border-red-500/20 bg-red-500/[0.05]">
          <div className="text-sm text-red-300">{error}</div>
        </Panel>
      )}

      <div className="grid gap-3">
        {ASSET_TYPES.map((t) => {
          const matching = assets.filter((a) => a.asset_type === t.value);
          return (
            <Panel key={t.value}>
              <div className="flex items-baseline justify-between gap-4">
                <div>
                  <div className="font-semibold text-white">{t.label}</div>
                  <div className="text-xs text-white/35 mt-0.5">{t.hint}</div>
                </div>
                <label className="cursor-pointer px-4 py-2 text-xs font-medium bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.08] rounded-full text-white/70 hover:text-white transition-all duration-200 whitespace-nowrap">
                  {uploading ? 'Uploading…' : '+ Upload'}
                  <input type="file" multiple className="hidden" onChange={(e) => onUpload(e, t.value)} disabled={uploading} />
                </label>
              </div>
              {matching.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {matching.map((a) => (
                    <a
                      key={a.id}
                      href={a.drive_file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs px-3 py-1.5 rounded-full transition-all duration-200"
                      style={{
                        background: 'rgba(26,231,246,0.08)',
                        border: '1px solid rgba(26,231,246,0.22)',
                        color: '#1AE7F6',
                      }}
                    >
                      {a.filename}
                    </a>
                  ))}
                </div>
              )}
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
