import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Download, Search, Loader2, Zap } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId?: number
}

export function ImportFromGhlDialog({ open, onOpenChange, companyId }: Props) {
  const queryClient = useQueryClient()
  const [selectedCompany, setSelectedCompany] = useState<number>(companyId || 0)
  const [searchQuery, setSearchQuery] = useState('')
  const [autoProcess, setAutoProcess] = useState(true)

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: api.getCompanies,
  })

  const importMutation = useMutation({
    mutationFn: () => api.importFromGhl({
      company_id: selectedCompany,
      query: searchQuery || undefined,
      auto_process: autoProcess,
    }),
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ['enrichment-leads'] })
      queryClient.invalidateQueries({ queryKey: ['enrichment-stats'] })
      if (result.imported > 0) {
        toast.success(`Imported ${result.imported} contacts from GHL${result.skipped ? ` (${result.skipped} already existed)` : ''}`)
      } else if (result.skipped > 0) {
        toast.info(`All ${result.skipped} contacts already exist in enrichment pipeline`)
      } else {
        toast.info('No contacts found matching your search')
      }
      onOpenChange(false)
      setSearchQuery('')
    },
    onError: (err: any) => toast.error(err.message || 'Import failed'),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5 text-accent" />
            Import from GoHighLevel
          </DialogTitle>
          <DialogDescription>
            Pull contacts from GHL into the enrichment pipeline for processing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Company selector */}
          <div>
            <label className="text-sm font-medium block mb-1">Company</label>
            <select
              value={selectedCompany}
              onChange={(e) => setSelectedCompany(parseInt(e.target.value))}
              className="w-full px-3 py-2 rounded-md bg-muted border border-border text-sm"
            >
              <option value={0}>Select company...</option>
              {(Array.isArray(companies) ? companies : []).map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Search query */}
          <div>
            <label className="text-sm font-medium block mb-1">
              Search filter <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="e.g. 'needs review', email, name..."
                className="w-full pl-9 pr-3 py-2 rounded-md bg-muted border border-border text-sm"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Leave blank to import all contacts. Use a name, email, or tag to filter.
            </p>
          </div>

          {/* Auto-process toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoProcess}
              onChange={(e) => setAutoProcess(e.target.checked)}
              className="rounded border-border"
            />
            <Zap className="h-3.5 w-3.5 text-yellow-400" />
            <span className="text-sm">Auto-enrich & score after import</span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => importMutation.mutate()}
            disabled={!selectedCompany || importMutation.isPending}
          >
            {importMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                Importing...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-1" />
                Import Contacts
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
