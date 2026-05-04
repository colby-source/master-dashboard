import { useEffect, useState, useCallback, useRef } from 'react';
import { launchpadAdmin } from '../lib/api/launchpad';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  invited: { label: 'Invited', color: 'bg-stone-700 text-stone-200' },
  intake_started: { label: 'Intake In Progress', color: 'bg-blue-900 text-blue-200' },
  intake_complete: { label: 'Intake Complete', color: 'bg-blue-800 text-blue-100' },
  strategy_generated: { label: 'Strategy Generated', color: 'bg-indigo-900 text-indigo-200' },
  assets_uploading: { label: 'Uploading Assets', color: 'bg-violet-900 text-violet-200' },
  submitted: { label: 'Submitted', color: 'bg-amber-900 text-amber-200' },
  in_review: { label: 'In Review', color: 'bg-amber-800 text-amber-100' },
  needs_changes: { label: 'Needs Changes', color: 'bg-orange-900 text-orange-200' },
  approved: { label: 'Approved', color: 'bg-emerald-900 text-emerald-200' },
  rejected: { label: 'Rejected', color: 'bg-red-900 text-red-200' },
  launched: { label: 'Launched', color: 'bg-cyan-900 text-cyan-200' },
};

export default function LaunchpadAdminPage() {
  const [brands, setBrands] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    launchpadAdmin.list()
      .then((r) => setBrands(r.brands))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let cancelled = false;
    launchpadAdmin.list()
      .then((r) => { if (!cancelled) setBrands(r.brands); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="p-6 space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Brand Launchpad</h1>
          <p className="text-sm text-muted-foreground mt-1">Onboard new BMN brands. {brands.length} active.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 text-sm font-medium bg-teal-700 hover:bg-teal-600 text-white rounded"
        >
          + Invite a brand
        </button>
      </header>

      {showCreate && (
        <CreateBrandModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refresh(); }}
          setCreating={setCreating}
          creating={creating}
        />
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-6">
          <div className="space-y-2">
            {brands.length === 0 && (
              <div className="text-sm text-muted-foreground p-6 border border-dashed border-stone-700 rounded">
                No brands yet. Click "Invite a brand" to get started.
              </div>
            )}
            {brands.map((b) => {
              const s = STATUS_LABELS[b.status] || { label: b.status, color: 'bg-stone-700' };
              const selected = selectedId === b.id;
              return (
                <button
                  key={b.id}
                  onClick={() => setSelectedId(b.id)}
                  className={`w-full text-left p-3 border rounded transition ${selected ? 'border-cyan-500 bg-cyan-950/30' : 'border-stone-800 hover:border-stone-700'}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-medium">{b.brandName}</div>
                    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${s.color}`}>{s.label}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{b.founderEmail}</div>
                  {b.launchDate && <div className="text-xs text-muted-foreground mt-1">Launch {new Date(b.launchDate).toLocaleDateString()}</div>}
                </button>
              );
            })}
          </div>

          <div>
            {selectedId ? (
              <BrandDetail brandId={selectedId} onChange={refresh} />
            ) : (
              <div className="text-sm text-muted-foreground p-6 border border-dashed border-stone-700 rounded">
                Select a brand on the left.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CreateBrandModal({ onClose, onCreated, creating, setCreating }: {
  onClose: () => void;
  onCreated: () => void;
  creating: boolean;
  setCreating: (b: boolean) => void;
}) {
  const [form, setForm] = useState({ brandName: '', founderName: '', founderEmail: '', launchDate: '' });
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ magicLinkUrl: string; expiresAt: string } | null>(null);

  const submit = async () => {
    setCreating(true);
    setError(null);
    try {
      const r = await launchpadAdmin.create({
        brandName: form.brandName,
        founderName: form.founderName || undefined,
        founderEmail: form.founderEmail,
        launchDate: form.launchDate || undefined,
        sendEmail: true,
      });
      setResult({ magicLinkUrl: r.magicLinkUrl, expiresAt: r.magicLinkExpiresAt });
    } catch (err) {
      setError(String(err));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-6 z-50" onClick={onClose}>
      <div className="bg-stone-950 border border-stone-800 rounded-lg max-w-lg w-full p-6" onClick={(e) => e.stopPropagation()}>
        {!result ? (
          <>
            <h2 className="text-lg font-semibold mb-4">Invite a brand</h2>
            <div className="space-y-3">
              <input className="w-full bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm" placeholder="Brand name *" value={form.brandName} onChange={(e) => setForm({ ...form, brandName: e.target.value })} />
              <input className="w-full bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm" placeholder="Founder name" value={form.founderName} onChange={(e) => setForm({ ...form, founderName: e.target.value })} />
              <input className="w-full bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm" placeholder="Founder email *" type="email" value={form.founderEmail} onChange={(e) => setForm({ ...form, founderEmail: e.target.value })} />
              <input className="w-full bg-stone-900 border border-stone-800 rounded px-3 py-2 text-sm" placeholder="Launch date" type="date" value={form.launchDate} onChange={(e) => setForm({ ...form, launchDate: e.target.value })} />
              {error && <div className="text-sm text-red-400">{error}</div>}
            </div>
            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={onClose} className="px-4 py-2 text-sm bg-stone-800 hover:bg-stone-700 rounded">Cancel</button>
              <button onClick={submit} disabled={creating || !form.brandName || !form.founderEmail} className="px-4 py-2 text-sm bg-teal-700 hover:bg-teal-600 text-white rounded disabled:opacity-40">
                {creating ? 'Creating…' : 'Create + send link'}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold mb-4 text-cyan-300">Brand invited ✓</h2>
            <p className="text-sm text-stone-400 mb-3">Magic link sent to {form.founderEmail}. The brand can also access it directly:</p>
            <div className="bg-stone-900 border border-stone-800 rounded p-3 text-xs font-mono break-all text-stone-300">
              {result.magicLinkUrl}
            </div>
            <div className="text-xs text-stone-500 mt-2">Expires {new Date(result.expiresAt).toLocaleString()}</div>
            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => navigator.clipboard.writeText(result.magicLinkUrl)} className="px-4 py-2 text-sm bg-stone-800 hover:bg-stone-700 rounded">Copy link</button>
              <button onClick={onCreated} className="px-4 py-2 text-sm bg-teal-700 hover:bg-teal-600 text-white rounded">Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * PreBakePanel — Admin UI to pre-populate brand direction before sending
 * the magic link. This is the new recommended flow:
 *
 *   1. Create brand (basic info only)
 *   2. Open PreBakePanel → fill intake fields + upload assets
 *   3. Seal prep → validate minimum pre-bake
 *   4. Send magic link
 *
 * Creator opens the wizard in review mode: reads brand direction, comments,
 * approves, then focuses on content review.
 */
function PreBakePanel({ brandId, intake, assets, onRefresh }: {
  brandId: string;
  intake: any;
  assets: any[];
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sealResult, setSealResult] = useState<{ ok: boolean; missing?: string[] } | null>(null);

  // Intake field form state
  const [form, setForm] = useState({
    brand_name: intake?.brand_name || '',
    founder_name: intake?.founder_name || '',
    founder_handle: intake?.founder_handle || '',
    niche: intake?.niche || '',
    founder_story: intake?.founder_story || '',
    signature_belief: intake?.signature_belief || '',
    // Voice (comma-separated for simplicity in admin UI)
    brand_voice_dos: (intake?.brand_voice_dos || []).join(', '),
    brand_voice_donts: (intake?.brand_voice_donts || []).join(', '),
    off_limits_topics: (intake?.off_limits_topics || []).join(', '),
    visual_style_notes: intake?.visual_style_notes || '',
    // ICP (flattened)
    icp_demographic: intake?.primary_icp?.demographic || '',
    icp_psychographic: intake?.primary_icp?.psychographic || '',
    // Channels
    primary_platform: intake?.primary_platform || '',
    posting_capacity: intake?.posting_capacity || '',
    primary_goal: intake?.primary_goal || '',
    price_point_range: intake?.price_point_range || '',
    launch_date: intake?.launch_date || '',
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadType, setUploadType] = useState<string>('logo');
  const [uploading, setUploading] = useState(false);

  const isPrepSealed = !!(intake as Record<string, unknown> | null)?.['admin_prep_sealed'];
  const assetsByType: Record<string, number> = {};
  for (const a of assets) {
    assetsByType[a.asset_type] = (assetsByType[a.asset_type] || 0) + 1;
  }

  const saveIntake = async () => {
    setBusy('intake');
    setError(null);
    try {
      const patch: Record<string, unknown> = {
        brand_name: form.brand_name.trim() || undefined,
        founder_name: form.founder_name.trim() || undefined,
        founder_handle: form.founder_handle.trim() || undefined,
        niche: form.niche.trim() || undefined,
        founder_story: form.founder_story.trim() || undefined,
        signature_belief: form.signature_belief.trim() || undefined,
        brand_voice_dos: form.brand_voice_dos.split(',').map((s) => s.trim()).filter(Boolean),
        brand_voice_donts: form.brand_voice_donts.split(',').map((s) => s.trim()).filter(Boolean),
        off_limits_topics: form.off_limits_topics.split(',').map((s) => s.trim()).filter(Boolean),
        visual_style_notes: form.visual_style_notes.trim() || undefined,
        primary_platform: form.primary_platform || undefined,
        posting_capacity: form.posting_capacity || undefined,
        primary_goal: form.primary_goal || undefined,
        price_point_range: form.price_point_range.trim() || undefined,
        launch_date: form.launch_date || undefined,
        primary_icp: (form.icp_demographic || form.icp_psychographic)
          ? {
              demographic: form.icp_demographic.trim(),
              psychographic: form.icp_psychographic.trim(),
              where_they_hang_out: [],
            }
          : undefined,
      };
      // Remove undefined keys so we don't overwrite existing data with nulls
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      await launchpadAdmin.patchAdminIntake(brandId, clean);
      onRefresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const uploadAsset = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        await launchpadAdmin.uploadAdminAsset(brandId, file, uploadType);
      }
      onRefresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const sealPrep = async () => {
    setBusy('seal');
    setError(null);
    setSealResult(null);
    try {
      const r = await launchpadAdmin.sealPrep(brandId);
      setSealResult(r);
      if (r.ok) onRefresh();
    } catch (err) {
      // 422 validation error returns missing[]
      const msg = String(err);
      setError(msg);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="border border-stone-800 rounded p-4 space-y-3">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full flex items-center justify-between text-sm font-medium"
      >
        <span className="flex items-center gap-2">
          Pre-bake brand direction
          {isPrepSealed && (
            <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-900 text-emerald-200">
              Sealed
            </span>
          )}
        </span>
        <span className="text-stone-500 text-xs">{open ? 'Collapse ↑' : 'Expand ↓'}</span>
      </button>

      {open && (
        <div className="space-y-5 pt-2">
          <p className="text-xs text-stone-400 leading-relaxed">
            Fill in brand direction details and upload assets BEFORE sending the magic link.
            The creator will see a read-only review instead of data-entry forms.
          </p>

          {/* Asset summary */}
          <div className="grid grid-cols-3 gap-2 text-xs">
            {['logo', 'product_photo', 'founder_photo', 'brand_guide'].map((t) => (
              <div key={t} className="border border-stone-800 rounded px-2 py-1.5">
                <div className={`text-base font-semibold ${(assetsByType[t] || 0) > 0 ? 'text-emerald-300' : 'text-stone-500'}`}>
                  {assetsByType[t] || 0}
                </div>
                <div className="text-[10px] uppercase tracking-wider text-stone-500">{t.replace('_', ' ')}</div>
              </div>
            ))}
          </div>

          {/* Asset upload */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-stone-300">Upload assets</div>
            <div className="flex gap-2 flex-wrap">
              <select
                value={uploadType}
                onChange={(e) => setUploadType(e.target.value)}
                className="bg-stone-900 border border-stone-800 rounded px-2 py-1 text-xs text-stone-300"
              >
                <option value="logo">Logo</option>
                <option value="brand_guide">Brand guide</option>
                <option value="founder_photo">Founder photo</option>
                <option value="product_photo">Product photo</option>
                <option value="other">Other</option>
              </select>
              <label className="cursor-pointer px-3 py-1.5 text-xs bg-stone-800 hover:bg-stone-700 text-stone-300 rounded">
                {uploading ? 'Uploading…' : '+ Choose files'}
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={uploadAsset}
                  disabled={uploading}
                />
              </label>
            </div>
          </div>

          {/* Intake fields */}
          <div className="space-y-3">
            <div className="text-xs font-medium text-stone-300">Brand direction fields</div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <AdminInput label="Brand name" value={form.brand_name} onChange={(v) => setForm({ ...form, brand_name: v })} />
              <AdminInput label="Founder name" value={form.founder_name} onChange={(v) => setForm({ ...form, founder_name: v })} />
              <AdminInput label="Primary handle" value={form.founder_handle} onChange={(v) => setForm({ ...form, founder_handle: v })} placeholder="@handle" />
              <AdminInput label="Primary platform" value={form.primary_platform} onChange={(v) => setForm({ ...form, primary_platform: v })} placeholder="instagram | tiktok | youtube" />
              <AdminInput label="Launch date" type="date" value={form.launch_date} onChange={(v) => setForm({ ...form, launch_date: v })} />
              <AdminInput label="Price point range" value={form.price_point_range} onChange={(v) => setForm({ ...form, price_point_range: v })} placeholder="$30–$60" />
            </div>

            <AdminTextarea label="Niche (1 sentence)" value={form.niche} onChange={(v) => setForm({ ...form, niche: v })} rows={2} placeholder="e.g. clean skincare for postpartum moms" />
            <AdminTextarea label="Founder story (why this brand)" value={form.founder_story} onChange={(v) => setForm({ ...form, founder_story: v })} rows={3} />
            <AdminTextarea label="Signature belief" value={form.signature_belief} onChange={(v) => setForm({ ...form, signature_belief: v })} rows={2} />
            <AdminTextarea label="ICP — demographic" value={form.icp_demographic} onChange={(v) => setForm({ ...form, icp_demographic: v })} rows={2} />
            <AdminTextarea label="ICP — psychographic" value={form.icp_psychographic} onChange={(v) => setForm({ ...form, icp_psychographic: v })} rows={2} />
            <AdminInput label="Brand voice DOs (comma-separated)" value={form.brand_voice_dos} onChange={(v) => setForm({ ...form, brand_voice_dos: v })} placeholder="honest, warm, science-y" />
            <AdminInput label="Brand voice DON'Ts (comma-separated)" value={form.brand_voice_donts} onChange={(v) => setForm({ ...form, brand_voice_donts: v })} placeholder="preachy, jargon-heavy" />
            <AdminInput label="Off-limits topics (comma-separated)" value={form.off_limits_topics} onChange={(v) => setForm({ ...form, off_limits_topics: v })} />
            <AdminInput label="Visual style notes" value={form.visual_style_notes} onChange={(v) => setForm({ ...form, visual_style_notes: v })} placeholder="clean / minimal / clinical" />

            <button
              type="button"
              onClick={saveIntake}
              disabled={busy !== null}
              className="px-3 py-1.5 text-xs bg-cyan-700 hover:bg-cyan-600 text-white rounded disabled:opacity-40"
            >
              {busy === 'intake' ? 'Saving…' : 'Save intake fields'}
            </button>
          </div>

          {error && <div className="text-xs text-red-400">{error}</div>}

          {/* Seal */}
          <div className="border-t border-stone-800 pt-3 space-y-2">
            <div className="text-xs font-medium text-stone-300">Validate & seal</div>
            <p className="text-xs text-stone-500">
              Runs pre-bake validation (logo + 3 product photos + core intake fields). Seals the brand
              direction and makes the wizard open in review mode for the creator.
            </p>
            {sealResult && !sealResult.ok && sealResult.missing && (
              <div className="text-xs text-amber-400 space-y-1">
                <div>Missing pre-bake requirements:</div>
                <ul className="list-disc list-inside space-y-0.5">
                  {sealResult.missing.map((m) => <li key={m}>{m}</li>)}
                </ul>
              </div>
            )}
            {sealResult?.ok && (
              <div className="text-xs text-emerald-400">Sealed. Safe to send the magic link.</div>
            )}
            <button
              type="button"
              onClick={sealPrep}
              disabled={busy !== null || isPrepSealed}
              className="px-3 py-1.5 text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded disabled:opacity-40"
            >
              {busy === 'seal' ? 'Validating…' : isPrepSealed ? 'Already sealed ✓' : 'Validate & seal brand direction'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function AdminInput({
  label, value, onChange, placeholder, type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-wider text-stone-500">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-stone-900 border border-stone-800 rounded px-2 py-1.5 text-xs text-stone-200 placeholder-stone-600"
      />
    </div>
  );
}

function AdminTextarea({
  label, value, onChange, rows = 2, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] uppercase tracking-wider text-stone-500">{label}</label>
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-stone-900 border border-stone-800 rounded px-2 py-1.5 text-xs text-stone-200 placeholder-stone-600 resize-y"
      />
    </div>
  );
}

function ContentStudioPanel({ brandId }: { brandId: string }) {
  const [data, setData] = useState<{ sources: any[]; clips: any[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [s, c] = await Promise.all([launchpadAdmin.listSources(brandId), launchpadAdmin.listClips(brandId)]);
    setData({ sources: s.sources, clips: c.clips });
  }, [brandId]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([launchpadAdmin.listSources(brandId), launchpadAdmin.listClips(brandId)])
      .then(([s, c]) => { if (!cancelled) setData({ sources: s.sources, clips: c.clips }); })
      .catch(() => { /* not critical — section just won't render */ });
    return () => { cancelled = true; };
  }, [brandId]);

  const onGenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      await launchpadAdmin.generateContent(brandId, { generateLongform: true, chopExistingSources: true, autoMapToCalendar: true });
      await refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!data) return null;
  const { sources, clips } = data;
  const counts = {
    pending: clips.filter((c: any) => c.approvalStatus === 'pending').length,
    approved: clips.filter((c: any) => c.approvalStatus === 'approved').length,
    rejected: clips.filter((c: any) => c.approvalStatus === 'rejected').length,
  };

  return (
    <section className="border border-stone-800 rounded p-4">
      <div className="flex items-baseline justify-between mb-3">
        <div className="text-sm font-medium">Content studio</div>
        <button onClick={onGenerate} disabled={busy} className="px-3 py-1 text-xs bg-cyan-700 hover:bg-cyan-600 text-white rounded disabled:opacity-30">
          {busy ? 'Running pipeline (4-6 min)…' : (clips.length === 0 ? 'Generate content engine' : 'Generate more')}
        </button>
      </div>
      {error && <div className="text-xs text-red-400 mb-2">{error}</div>}
      <div className="grid grid-cols-4 gap-2 text-xs">
        <Stat label="Long-form sources" value={sources.length} />
        <Stat label="Pending review" value={counts.pending} tone={counts.pending > 0 ? 'amber' : undefined} />
        <Stat label="Approved" value={counts.approved} tone="emerald" />
        <Stat label="Rejected" value={counts.rejected} tone={counts.rejected > 0 ? 'red' : undefined} />
      </div>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'amber' | 'emerald' | 'red' }) {
  const color = tone === 'amber' ? 'text-amber-300' : tone === 'emerald' ? 'text-emerald-300' : tone === 'red' ? 'text-red-300' : 'text-stone-200';
  return (
    <div className="border border-stone-800 rounded px-3 py-2">
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-stone-500">{label}</div>
    </div>
  );
}

function BrandDetail({ brandId, onChange }: { brandId: string; onChange: () => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [magicLink, setMagicLink] = useState<{ url: string; expiresAt: string } | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    launchpadAdmin.get(brandId)
      .then(setData)
      .finally(() => setLoading(false));
  }, [brandId]);

  useEffect(() => {
    let cancelled = false;
    launchpadAdmin.get(brandId)
      .then((d) => { if (!cancelled) setData(d); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [brandId]);

  const action = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await fn();
      refresh();
      onChange();
    } catch (err) {
      alert(String(err));
    } finally {
      setBusy(null);
    }
  };

  if (loading || !data) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const { brand, statusLog, reviews, assets } = data;
  const s = STATUS_LABELS[brand.status] || { label: brand.status, color: 'bg-stone-700' };

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h2 className="text-xl font-semibold">{brand.brandName}</h2>
          <div className="text-sm text-muted-foreground mt-1">{brand.founderEmail}</div>
        </div>
        <span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded ${s.color}`}>{s.label}</span>
      </header>

      <section className="border border-stone-800 rounded p-4 space-y-3">
        <div className="text-sm font-medium">Quick actions</div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={async () => {
              setBusy('show-link');
              try {
                const r = await launchpadAdmin.newMagicLink(brand.id, false);
                setMagicLink({ url: r.url, expiresAt: r.expiresAt });
              } catch (err) {
                alert(String(err));
              } finally {
                setBusy(null);
              }
            }}
            disabled={busy !== null}
            className="px-3 py-1.5 text-xs bg-cyan-700 hover:bg-cyan-600 text-white rounded">
            {busy === 'show-link' ? 'Loading…' : 'Show / copy magic link'}
          </button>
          <button onClick={() => action('magic-link', () => launchpadAdmin.newMagicLink(brand.id, true))}
            disabled={busy !== null}
            className="px-3 py-1.5 text-xs bg-stone-800 hover:bg-stone-700 rounded">
            {busy === 'magic-link' ? 'Sending…' : 'Resend magic link via email'}
          </button>
          {brand.status === 'intake_complete' && (
            <button onClick={() => action('generate', () => launchpadAdmin.generateStrategy(brand.id))}
              disabled={busy !== null}
              className="px-3 py-1.5 text-xs bg-cyan-700 hover:bg-cyan-600 text-white rounded">
              {busy === 'generate' ? 'Generating (3-4 min)…' : 'Generate strategy'}
            </button>
          )}
          {(brand.status === 'submitted' || brand.status === 'in_review') && (
            <>
              <button onClick={() => action('approve', () => launchpadAdmin.approve(brand.id))}
                disabled={busy !== null}
                className="px-3 py-1.5 text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded">
                Approve
              </button>
              <button onClick={() => {
                const note = prompt('What needs changes?');
                if (note) action('changes', () => launchpadAdmin.requestChanges(brand.id, note));
              }} disabled={busy !== null}
                className="px-3 py-1.5 text-xs bg-orange-700 hover:bg-orange-600 text-white rounded">
                Request changes
              </button>
              <button onClick={() => {
                const reason = prompt('Rejection reason?');
                if (reason) action('reject', () => launchpadAdmin.reject(brand.id, reason));
              }} disabled={busy !== null}
                className="px-3 py-1.5 text-xs bg-red-800 hover:bg-red-700 text-white rounded">
                Reject
              </button>
            </>
          )}
          {brand.status === 'approved' && (
            <button onClick={() => action('launch', () => launchpadAdmin.markLaunched(brand.id))}
              disabled={busy !== null}
              className="px-3 py-1.5 text-xs bg-cyan-700 hover:bg-cyan-600 text-white rounded">
              Mark launched
            </button>
          )}
          {brand.driveFolderUrl && (
            <a href={brand.driveFolderUrl} target="_blank" rel="noopener noreferrer"
              className="px-3 py-1.5 text-xs bg-stone-800 hover:bg-stone-700 rounded">
              Open Drive folder ↗
            </a>
          )}
          <a href={launchpadAdmin.calendarCsvUrl(brand.id)} target="_blank" rel="noopener noreferrer"
            className="px-3 py-1.5 text-xs bg-stone-800 hover:bg-stone-700 rounded">
            Calendar CSV ↓
          </a>
          {brand.status === 'approved' && (
            <button onClick={() => action('redeliver', () => launchpadAdmin.deliver(brand.id, true))}
              disabled={busy !== null}
              className="px-3 py-1.5 text-xs bg-stone-800 hover:bg-stone-700 rounded">
              {busy === 'redeliver' ? 'Delivering…' : 'Re-write deliverables + email'}
            </button>
          )}
        </div>

        {magicLink && (
          <div className="mt-3 bg-stone-900 border border-cyan-900 rounded p-3 space-y-2">
            <div className="text-xs text-stone-400">Magic link (expires {new Date(magicLink.expiresAt).toLocaleString()}):</div>
            <div className="font-mono text-xs break-all text-cyan-200">{magicLink.url}</div>
            <div className="flex gap-2">
              <button
                onClick={() => navigator.clipboard.writeText(magicLink.url)}
                className="px-2 py-1 text-xs bg-stone-800 hover:bg-stone-700 rounded">
                Copy
              </button>
              <a href={magicLink.url} target="_blank" rel="noopener noreferrer"
                className="px-2 py-1 text-xs bg-stone-800 hover:bg-stone-700 rounded">
                Open ↗
              </a>
              <button
                onClick={() => setMagicLink(null)}
                className="px-2 py-1 text-xs text-stone-500 hover:text-stone-300">
                Dismiss
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Pre-bake panel — always visible for invited/intake_started brands */}
      {['invited', 'intake_started', 'intake_complete'].includes(brand.status) && (
        <PreBakePanel
          brandId={brand.id}
          intake={brand.intake}
          assets={assets}
          onRefresh={() => { refresh(); onChange(); }}
        />
      )}

      {brand.intake && (
        <details className="border border-stone-800 rounded p-4">
          <summary className="cursor-pointer text-sm font-medium">Intake data</summary>
          <pre className="mt-3 text-xs text-muted-foreground overflow-auto max-h-80">{JSON.stringify(brand.intake, null, 2)}</pre>
        </details>
      )}

      {brand.strategy && (
        <details className="border border-stone-800 rounded p-4">
          <summary className="cursor-pointer text-sm font-medium">Generated strategy ({Object.keys(brand.strategy).length} keys)</summary>
          <pre className="mt-3 text-xs text-muted-foreground overflow-auto max-h-96">{JSON.stringify(brand.strategy, null, 2)}</pre>
        </details>
      )}

      <ContentStudioPanel brandId={brand.id} />

      {assets.length > 0 && (
        <section className="border border-stone-800 rounded p-4">
          <div className="text-sm font-medium mb-3">Uploaded assets ({assets.length})</div>
          <div className="space-y-1">
            {assets.map((a: any) => (
              <a key={a.id} href={a.drive_file_url} target="_blank" rel="noopener noreferrer"
                className="block text-xs text-stone-300 hover:text-cyan-300">
                <span className="text-stone-500">[{a.asset_type}]</span> {a.filename}
              </a>
            ))}
          </div>
        </section>
      )}

      {reviews.length > 0 && (
        <section className="border border-stone-800 rounded p-4">
          <div className="text-sm font-medium mb-3">Module reviews</div>
          <div className="space-y-2">
            {reviews.map((r: any) => (
              <div key={r.module_number} className="text-xs">
                <span className="font-medium">Module {r.module_number}:</span>
                <span className={`ml-2 px-1.5 py-0.5 rounded ${r.status === 'approved' ? 'bg-emerald-900 text-emerald-200' : 'bg-orange-900 text-orange-200'}`}>{r.status}</span>
                {r.feedback && <div className="text-muted-foreground mt-1">{r.feedback}</div>}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="border border-stone-800 rounded p-4">
        <div className="text-sm font-medium mb-3">Status history</div>
        <div className="space-y-1 text-xs">
          {statusLog.slice(0, 10).map((l: any, i: number) => (
            <div key={i} className="flex gap-3 text-muted-foreground">
              <span>{new Date(l.created_at).toLocaleString()}</span>
              <span>{l.from_status || '·'} → <span className="text-stone-300">{l.to_status}</span></span>
              <span className="text-stone-500">({l.actor})</span>
              {l.note && <span className="text-stone-500">{l.note}</span>}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
