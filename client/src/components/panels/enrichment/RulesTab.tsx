import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '../../../lib/api'
import {
  XCircle, RefreshCw, Shield, UserCheck,
} from 'lucide-react'

export function RulesTab({ rules, knownContacts, companyId, onDeleteRule }: {
  rules: any[]; knownContacts: any[]; companyId?: number; onDeleteRule: (id: number) => void
}) {
  const queryClient = useQueryClient()
  const [newRule, setNewRule] = useState({ rule_type: 'source_exclude', rule_value: '', description: '' })
  const [newContact, setNewContact] = useState({ email: '', first_name: '', last_name: '' })

  const createRule = useMutation({
    mutationFn: (data: any) => api.createColdEmailRule({ ...data, company_id: companyId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cold-email-rules'] })
      setNewRule({ rule_type: 'source_exclude', rule_value: '', description: '' })
      toast.success('Rule created')
    },
    onError: () => toast.error('Failed to create rule'),
  })

  const createContact = useMutation({
    mutationFn: (data: any) => api.createKnownContact({ ...data, company_id: companyId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['known-contacts'] })
      setNewContact({ email: '', first_name: '', last_name: '' })
      toast.success('Contact created')
    },
    onError: () => toast.error('Failed to create contact'),
  })

  const deleteContact = useMutation({
    mutationFn: (id: number) => api.deleteKnownContact(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['known-contacts'] })
      toast.success('Contact deleted')
    },
    onError: () => toast.error('Failed to delete contact'),
  })

  const importGhl = useMutation({
    mutationFn: () => {
      if (!companyId) { toast.error('Select a company first'); return Promise.reject(new Error('No company selected')) }
      return api.importKnownContactsFromGhl(companyId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['known-contacts'] })
      toast.success('GHL import started')
    },
    onError: () => toast.error('GHL import failed'),
  })

  return (
    <div className="space-y-6">
      {/* Cold Email Exclusion Rules */}
      <div>
        <h4 className="text-sm font-medium mb-2 flex items-center gap-1">
          <Shield className="h-4 w-4 text-yellow-400" /> Cold Email Exclusion Rules
        </h4>
        <div className="space-y-1.5 mb-3">
          {rules.length === 0 ? (
            <div className="text-xs text-muted-foreground py-2">No rules configured</div>
          ) : (
            rules.map((rule: any) => (
              <div key={rule.id} className="flex items-center justify-between p-2 bg-muted/30 rounded text-sm">
                <div>
                  <span className="px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs rounded mr-2">
                    {rule.rule_type?.replace(/_/g, ' ')}
                  </span>
                  <span>{rule.rule_value}</span>
                  {rule.description && <span className="text-xs text-muted-foreground ml-2">— {rule.description}</span>}
                </div>
                <button onClick={() => onDeleteRule(rule.id)} className="p-1 rounded hover:bg-red-500/20">
                  <XCircle className="h-3.5 w-3.5 text-red-400" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Add Rule Form */}
        <div className="flex gap-2">
          <select
            value={newRule.rule_type}
            onChange={e => setNewRule({ ...newRule, rule_type: e.target.value })}
            className="bg-muted border border-border rounded px-2 py-1 text-xs"
          >
            <option value="source_exclude">Source Exclude</option>
            <option value="domain_exclude">Domain Exclude</option>
            <option value="tag_exclude">Tag Exclude</option>
          </select>
          <input
            value={newRule.rule_value}
            onChange={e => setNewRule({ ...newRule, rule_value: e.target.value })}
            placeholder="Value (e.g. granitepark.co)"
            className="flex-1 bg-muted border border-border rounded px-2 py-1 text-xs"
          />
          <button
            onClick={() => newRule.rule_value && createRule.mutate(newRule)}
            disabled={!newRule.rule_value}
            className="px-2 py-1 text-xs rounded bg-accent hover:bg-accent/80 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>

      {/* Known Contacts */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium flex items-center gap-1">
            <UserCheck className="h-4 w-4 text-green-400" /> Known Contacts ({knownContacts.length})
          </h4>
          <button
            onClick={() => importGhl.mutate()}
            className="px-2 py-1 text-xs rounded bg-muted hover:bg-muted/80 flex items-center gap-1"
          >
            <RefreshCw className="h-3 w-3" /> Import from GHL
          </button>
        </div>
        <div className="space-y-1 mb-3 max-h-48 overflow-y-auto">
          {knownContacts.slice(0, 20).map((c: any) => (
            <div key={c.id} className="flex items-center justify-between p-1.5 text-sm hover:bg-muted/30 rounded">
              <div>
                <span>{c.first_name} {c.last_name}</span>
                <span className="text-muted-foreground ml-2">{c.email}</span>
              </div>
              <button onClick={() => deleteContact.mutate(c.id)} className="p-1 rounded hover:bg-red-500/20">
                <XCircle className="h-3 w-3 text-red-400" />
              </button>
            </div>
          ))}
        </div>

        {/* Add Contact Form */}
        <div className="flex gap-2">
          <input
            value={newContact.email}
            onChange={e => setNewContact({ ...newContact, email: e.target.value })}
            placeholder="Email"
            className="flex-1 bg-muted border border-border rounded px-2 py-1 text-xs"
          />
          <input
            value={newContact.first_name}
            onChange={e => setNewContact({ ...newContact, first_name: e.target.value })}
            placeholder="First"
            className="bg-muted border border-border rounded px-2 py-1 text-xs w-20"
          />
          <input
            value={newContact.last_name}
            onChange={e => setNewContact({ ...newContact, last_name: e.target.value })}
            placeholder="Last"
            className="bg-muted border border-border rounded px-2 py-1 text-xs w-20"
          />
          <button
            onClick={() => newContact.email && createContact.mutate(newContact)}
            disabled={!newContact.email}
            className="px-2 py-1 text-xs rounded bg-accent hover:bg-accent/80 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
