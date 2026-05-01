import { useEffect, useState, useCallback } from 'react';
import { launchpadPublic } from '../../lib/api/launchpad';
import type { Session } from './_types';

interface AssetRow {
  id: string;
  asset_type: string;
  filename: string;
  drive_file_url: string;
}

const ASSET_TYPES: Array<{ value: string; label: string; hint: string }> = [
  { value: 'logo', label: 'Logo', hint: 'PNG with transparency, plus a 1:1 social variant' },
  { value: 'product_photo', label: 'Product photos', hint: 'Min 5 — front, hand-held, lifestyle' },
  { value: 'founder_photo', label: 'Founder photos', hint: 'For about / story content' },
  { value: 'brand_guide', label: 'Brand guide', hint: 'PDF or any reference doc' },
  { value: 'finalized_post', label: 'Finalized posts (visuals + captions)', hint: 'Per the 30-day calendar' },
  { value: 'video', label: 'Videos / reels', hint: 'Raw or edited' },
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
      <h2 className="text-2xl font-semibold">Upload your finalized assets</h2>
      <p className="text-stone-400">Everything needed to ship the 30-day sprint. All uploads land in your private Google Drive folder.</p>
      {session.driveFolderUrl && (
        <a href={session.driveFolderUrl} target="_blank" rel="noopener noreferrer" className="text-cyan-300 text-sm underline">
          Open my Drive folder ↗
        </a>
      )}

      {error && <div className="text-sm text-red-400">{error}</div>}

      <div className="grid gap-3">
        {ASSET_TYPES.map((t) => {
          const matching = assets.filter((a) => a.asset_type === t.value);
          return (
            <div key={t.value} className="border border-stone-800 rounded p-4">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="font-medium text-stone-200">{t.label}</div>
                  <div className="text-xs text-stone-500">{t.hint}</div>
                </div>
                <label className="cursor-pointer px-3 py-1.5 text-xs bg-stone-800 hover:bg-stone-700 rounded">
                  {uploading ? 'Uploading…' : '+ Upload'}
                  <input type="file" multiple className="hidden" onChange={(e) => onUpload(e, t.value)} disabled={uploading} />
                </label>
              </div>
              {matching.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {matching.map((a) => (
                    <a key={a.id} href={a.drive_file_url} target="_blank" rel="noopener noreferrer"
                       className="text-xs px-2 py-1 bg-teal-900/40 border border-teal-800 text-teal-200 rounded hover:bg-teal-900/60">
                      {a.filename}
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
