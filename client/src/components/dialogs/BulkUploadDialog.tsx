import { useState, useRef, useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import Papa from 'papaparse'
import { api } from '@/lib/api'
import { autoDetectMapping, applyMapping, cleanHeader, LEAD_FIELDS, type LeadFieldKey } from '@/lib/csv-mapping'
import { useImportProgress } from '@/hooks/use-import-progress'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  Upload, FileSpreadsheet, ArrowRight, ArrowLeft, Check, X, Loader2, AlertTriangle,
} from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId?: number
}

type Step = 'file' | 'mapping' | 'preview' | 'progress'

export function BulkUploadDialog({ open, onOpenChange, companyId }: Props) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('file')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([])
  const [mapping, setMapping] = useState<Record<string, LeadFieldKey>>({})
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | undefined>(companyId)
  const [autoProcess, setAutoProcess] = useState(true)
  const [targetCampaignId, setTargetCampaignId] = useState('')
  const [importId, setImportId] = useState<number | null>(null)
  const [uploadResult, setUploadResult] = useState<any>(null)

  const progress = useImportProgress(importId)

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: api.getCompanies,
  })

  const { data: instantlyCampaigns = [] } = useQuery({
    queryKey: ['instantly-campaigns'],
    queryFn: async () => {
      const res = await api.instantlyCampaigns({ limit: 50 })
      return Array.isArray(res) ? res : (res as any)?.items ?? []
    },
  })

  const uploadMutation = useMutation({
    mutationFn: (data: any) => api.bulkUploadLeads(data),
    onSuccess: (result: any) => {
      setUploadResult(result)
      setImportId(result.import_id)
      setStep('progress')
      queryClient.invalidateQueries({ queryKey: ['enrichment-leads'] })
      queryClient.invalidateQueries({ queryKey: ['enrichment-stats'] })
      toast.success(`Uploaded ${result.inserted} leads (${result.duplicates} duplicates skipped)`)
    },
    onError: (err: any) => {
      toast.error(`Upload failed: ${err.message}`)
    },
  })

  const cancelMutation = useMutation({
    mutationFn: (id: number) => api.cancelBulkUpload(id),
    onSuccess: () => toast.success('Import cancelled'),
  })

  // ── File parsing ────────────────────────────────────────────

  const handleFileSelect = useCallback((file: File) => {
    setSelectedFile(file)
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => cleanHeader(h),
      complete: (result) => {
        const fields = result.meta.fields || []
        const rows = result.data as Record<string, string>[]
        if (fields.length === 0 || rows.length === 0) {
          toast.error('CSV file appears empty or could not be parsed. Check the file format.')
          return
        }
        setHeaders(fields)
        setRawRows(rows)
        setMapping(autoDetectMapping(fields))
      },
      error: () => {
        toast.error('Failed to parse CSV file')
      },
    })
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file?.name.endsWith('.csv')) handleFileSelect(file)
    else toast.error('Please drop a CSV file')
  }, [handleFileSelect])

  // ── Derived data ────────────────────────────────────────────

  const mappedLeads = applyMapping(rawRows, mapping)
  const leadsWithEmail = mappedLeads.filter(l => l.email)
  const hasEmailMapping = Object.values(mapping).includes('email')

  // ── Upload handler ──────────────────────────────────────────

  const handleUpload = () => {
    if (!selectedCompanyId) return toast.error('Select a company')
    if (!hasEmailMapping) return toast.error('Map at least one column to Email')

    uploadMutation.mutate({
      company_id: selectedCompanyId,
      file_name: selectedFile?.name || 'upload.csv',
      leads: leadsWithEmail,
      auto_process: autoProcess,
      target_campaign_id: targetCampaignId || undefined,
      column_mapping: mapping,
    })
  }

  // ── Reset ───────────────────────────────────────────────────

  const handleClose = () => {
    setStep('file')
    setSelectedFile(null)
    setHeaders([])
    setRawRows([])
    setMapping({})
    setImportId(null)
    setUploadResult(null)
    setTargetCampaignId('')
    onOpenChange(false)
  }

  const progressPercent = progress?.percent ?? 0
  const isComplete = progress?.status === 'complete' || progress?.status === 'cancelled'
  const isProcessing = uploadResult && !isComplete && autoProcess

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Bulk CSV Upload
          </DialogTitle>
          <DialogDescription>
            {step === 'file' && 'Select a CSV file and assign it to a company'}
            {step === 'mapping' && 'Map CSV columns to lead fields'}
            {step === 'preview' && 'Review and confirm upload'}
            {step === 'progress' && 'Upload progress'}
          </DialogDescription>
        </DialogHeader>

        {/* ── Step 1: File + Company ─────────────────────────── */}
        {step === 'file' && (
          <div className="space-y-4">
            <div
              onDrop={handleDrop}
              onDragOver={e => e.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
            >
              <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
              {selectedFile ? (
                <div>
                  <p className="font-medium">{selectedFile.name}</p>
                  <p className="text-sm text-muted-foreground">{rawRows.length} rows, {headers.length} columns</p>
                </div>
              ) : (
                <div>
                  <p className="font-medium">Drop CSV file here or click to browse</p>
                  <p className="text-sm text-muted-foreground">Supports .csv files</p>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) handleFileSelect(file)
              }}
            />

            <div>
              <label className="text-sm font-medium mb-1 block">Assign to Company</label>
              <select
                value={selectedCompanyId || ''}
                onChange={e => setSelectedCompanyId(Number(e.target.value))}
                className="w-full bg-muted border border-border rounded px-3 py-2 text-sm"
              >
                <option value="">Select company...</option>
                {(companies as any[]).map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* ── Step 2: Column Mapping ────────────────────────── */}
        {step === 'mapping' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Map each CSV column to a lead field. Email is required.</p>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {headers.map(header => (
                <div key={header} className="flex items-center gap-3">
                  <span className="text-sm font-mono bg-muted px-2 py-1 rounded min-w-[140px] truncate" title={header}>
                    {header}
                  </span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <select
                    value={mapping[header] || 'skip'}
                    onChange={e => setMapping(prev => ({ ...prev, [header]: e.target.value as LeadFieldKey }))}
                    className="flex-1 bg-muted border border-border rounded px-2 py-1 text-sm"
                  >
                    {LEAD_FIELDS.map(f => (
                      <option key={f.key} value={f.key}>
                        {f.label} {f.required ? '*' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            {headers.length === 0 && (
              <div className="flex items-center gap-2 text-amber-400 text-sm">
                <AlertTriangle className="h-4 w-4" />
                No columns detected — the CSV may be empty or in an unsupported format
              </div>
            )}
            {!hasEmailMapping && headers.length > 0 && (
              <div className="flex items-center gap-2 text-amber-400 text-sm">
                <AlertTriangle className="h-4 w-4" />
                No column mapped to Email (required)
              </div>
            )}
          </div>
        )}

        {/* ── Step 3: Preview + Options ─────────────────────── */}
        {step === 'preview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-muted rounded-lg p-3 text-center">
                <p className="text-2xl font-bold">{rawRows.length}</p>
                <p className="text-xs text-muted-foreground">Total Rows</p>
              </div>
              <div className="bg-muted rounded-lg p-3 text-center">
                <p className="text-2xl font-bold">{leadsWithEmail.length}</p>
                <p className="text-xs text-muted-foreground">With Email</p>
              </div>
            </div>

            {/* Preview table */}
            {leadsWithEmail.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-6 text-center border border-border rounded-lg">
                <AlertTriangle className="h-8 w-8 text-amber-400" />
                <p className="text-sm font-medium">No leads with a valid email found</p>
                <p className="text-xs text-muted-foreground max-w-sm">
                  Go back to the mapping step and make sure one of your CSV columns is mapped to <strong>Email</strong>.
                  {rawRows.length > 0 && ` (${rawRows.length} rows were parsed but none had an email value)`}
                </p>
              </div>
            ) : (
              <div className="border border-border rounded-lg overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-muted">
                      {Object.entries(mapping).filter(([, v]) => v !== 'skip').map(([col, field]) => (
                        <th key={col} className="px-2 py-1.5 text-left font-medium capitalize">
                          {field.replace('_', ' ')}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {leadsWithEmail.slice(0, 5).map((lead, i) => (
                      <tr key={i} className="border-t border-border">
                        {Object.entries(mapping).filter(([, v]) => v !== 'skip').map(([col, field]) => (
                          <td key={col} className="px-2 py-1.5 truncate max-w-[150px]">
                            {lead[field] || '-'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {leadsWithEmail.length > 5 && (
                  <p className="text-xs text-muted-foreground px-2 py-1 border-t border-border">
                    ... and {leadsWithEmail.length - 5} more rows
                  </p>
                )}
              </div>
            )}

            {/* Options */}
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoProcess}
                  onChange={e => setAutoProcess(e.target.checked)}
                  className="rounded"
                />
                Auto-process leads (enrich, score, push to GHL)
              </label>

              <div>
                <label className="text-sm font-medium mb-1 block">Target Instantly Campaign (optional)</label>
                <select
                  value={targetCampaignId}
                  onChange={e => setTargetCampaignId(e.target.value)}
                  className="w-full bg-muted border border-border rounded px-3 py-2 text-sm"
                >
                  <option value="">None — manual approval required</option>
                  {(instantlyCampaigns as any[]).map((c: any) => (
                    <option key={c.id || c.external_id} value={c.external_id || c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 4: Progress ──────────────────────────────── */}
        {step === 'progress' && (
          <div className="space-y-4">
            {/* Counters */}
            <div className="grid grid-cols-4 gap-2">
              <div className="bg-muted rounded-lg p-2 text-center">
                <p className="text-lg font-bold text-green-400">{uploadResult?.inserted || 0}</p>
                <p className="text-xs text-muted-foreground">Inserted</p>
              </div>
              <div className="bg-muted rounded-lg p-2 text-center">
                <p className="text-lg font-bold text-yellow-400">{uploadResult?.duplicates || 0}</p>
                <p className="text-xs text-muted-foreground">Duplicates</p>
              </div>
              <div className="bg-muted rounded-lg p-2 text-center">
                <p className="text-lg font-bold text-red-400">{uploadResult?.errors?.length || 0}</p>
                <p className="text-xs text-muted-foreground">Errors</p>
              </div>
              <div className="bg-muted rounded-lg p-2 text-center">
                <p className="text-lg font-bold text-blue-400">{progress?.processed || 0}</p>
                <p className="text-xs text-muted-foreground">Processed</p>
              </div>
            </div>

            {/* Progress bar */}
            {autoProcess && (
              <div>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-muted-foreground">
                    {isComplete
                      ? (progress?.status === 'cancelled' ? 'Cancelled' : 'Complete')
                      : 'Processing...'}
                  </span>
                  <span>{progressPercent}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2.5">
                  <div
                    className={`h-2.5 rounded-full transition-all duration-300 ${
                      isComplete ? 'bg-green-500' : 'bg-primary'
                    }`}
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}

            {/* Errors list */}
            {uploadResult?.errors?.length > 0 && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 max-h-[120px] overflow-y-auto">
                <p className="text-sm font-medium text-red-400 mb-1">Row Errors:</p>
                {uploadResult.errors.slice(0, 10).map((err: any, i: number) => (
                  <p key={i} className="text-xs text-red-300">
                    Row {err.row}: {err.error}
                  </p>
                ))}
                {uploadResult.errors.length > 10 && (
                  <p className="text-xs text-red-300/60">
                    ... and {uploadResult.errors.length - 10} more
                  </p>
                )}
              </div>
            )}

            {/* Cancel / Done */}
            {isProcessing && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => importId && cancelMutation.mutate(importId)}
                disabled={cancelMutation.isPending}
              >
                <X className="h-4 w-4 mr-1" /> Cancel Processing
              </Button>
            )}
          </div>
        )}

        {/* ── Footer ────────────────────────────────────────── */}
        <DialogFooter className="flex justify-between">
          {step === 'file' && (
            <Button
              onClick={() => setStep('mapping')}
              disabled={!selectedFile || !selectedCompanyId || rawRows.length === 0}
            >
              Next <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          )}

          {step === 'mapping' && (
            <div className="flex gap-2 w-full justify-between">
              <Button variant="outline" onClick={() => setStep('file')}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button onClick={() => setStep('preview')} disabled={!hasEmailMapping}>
                Next <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}

          {step === 'preview' && (
            <div className="flex gap-2 w-full justify-between">
              <Button variant="outline" onClick={() => setStep('mapping')}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button onClick={handleUpload} disabled={uploadMutation.isPending || leadsWithEmail.length === 0}>
                {uploadMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Uploading...</>
                ) : (
                  <><Upload className="h-4 w-4 mr-1" /> Upload {leadsWithEmail.length} Leads</>
                )}
              </Button>
            </div>
          )}

          {step === 'progress' && (
            <Button onClick={handleClose} disabled={isProcessing as boolean}>
              <Check className="h-4 w-4 mr-1" /> Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
