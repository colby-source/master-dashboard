import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { toast } from 'sonner'

type Tab = 'send' | 'templates' | 'phone-numbers'

export function WhatsAppPanel() {
  const [tab, setTab] = useState<Tab>('send')
  const tabs: { key: Tab; label: string }[] = [
    { key: 'send', label: 'Send Message' },
    { key: 'templates', label: 'Templates' },
    { key: 'phone-numbers', label: 'Phone Numbers' },
  ]

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold">WhatsApp</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">Cloud API</span>
        </div>
      </div>
      <div className="flex border-b border-border">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${tab === t.key ? 'text-foreground border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="p-4">
        {tab === 'send' && <SendTab />}
        {tab === 'templates' && <TemplatesTab />}
        {tab === 'phone-numbers' && <PhoneNumbersTab />}
      </div>
    </div>
  )
}

// ── Send Message ──────────────────────────────────────────────

function SendTab() {
  const [msgType, setMsgType] = useState<'text' | 'template' | 'image' | 'document'>('text')
  const [to, setTo] = useState('')
  const [body, setBody] = useState('')
  const [templateName, setTemplateName] = useState('')
  const [mediaUrl, setMediaUrl] = useState('')
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  const sendMut = useMutation({
    mutationFn: async () => {
      switch (msgType) {
        case 'text':
          return api.whatsappSendText(to, body)
        case 'template':
          return api.whatsappSendTemplate(to, templateName)
        case 'image':
          return api.whatsappSendImage(to, mediaUrl, body || undefined)
        case 'document':
          return api.whatsappSendDocument(to, mediaUrl, undefined, body || undefined)
      }
    },
    onSuccess: (data) => { setResult(data); setError(null); toast.success('Message sent'); },
    onError: (e: any) => { setError(e.message); setResult(null); toast.error('Failed to send message'); },
  })

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(['text', 'template', 'image', 'document'] as const).map(t => (
          <button key={t} onClick={() => setMsgType(t)}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors capitalize ${msgType === t ? 'bg-green-600 text-white border-green-600' : 'bg-muted/50 border-border text-muted-foreground hover:text-foreground'}`}>
            {t}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        <input type="text" value={to} onChange={e => setTo(e.target.value)}
          placeholder="Phone number (E.164, e.g. 16505551234)"
          className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />

        {msgType === 'template' ? (
          <input type="text" value={templateName} onChange={e => setTemplateName(e.target.value)}
            placeholder="Template name"
            className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
        ) : msgType === 'image' || msgType === 'document' ? (
          <>
            <input type="text" value={mediaUrl} onChange={e => setMediaUrl(e.target.value)}
              placeholder="Media URL (https://...)"
              className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
            <input type="text" value={body} onChange={e => setBody(e.target.value)}
              placeholder="Caption (optional)"
              className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary" />
          </>
        ) : (
          <textarea value={body} onChange={e => setBody(e.target.value)}
            placeholder="Message body..."
            className="w-full h-24 bg-muted/50 border border-border rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-primary" />
        )}
      </div>
      <div className="flex items-center gap-3">
        <button onClick={() => sendMut.mutate()} disabled={sendMut.isPending || !to}
          className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed">
          {sendMut.isPending ? 'Sending...' : 'Send'}
        </button>
      </div>
      {error && <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg p-3">{error}</div>}
      {result && (
        <div className="text-sm text-green-400 bg-green-500/10 border border-green-500/20 rounded-lg p-3">
          Sent! Message ID: {result.messages?.[0]?.id || JSON.stringify(result)}
        </div>
      )}
    </div>
  )
}

// ── Templates ─────────────────────────────────────────────────

function TemplatesTab() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['whatsapp-templates'],
    queryFn: () => api.whatsappListTemplates(),
  })

  const templates = data?.data ?? []

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading templates...</div>
  if (error) return <div className="text-sm text-red-400">Failed to load templates. Is WhatsApp configured?</div>

  return (
    <div className="space-y-2">
      {templates.length === 0 && <div className="text-sm text-muted-foreground">No templates found. Configure WhatsApp credentials first.</div>}
      {templates.map((tpl: any) => (
        <div key={tpl.id} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2">
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{tpl.name}</div>
            <div className="text-xs text-muted-foreground">
              {tpl.language} &middot; {tpl.category}
            </div>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded-full ${tpl.status === 'APPROVED' ? 'bg-green-500/20 text-green-400' : tpl.status === 'REJECTED' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
            {tpl.status}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Phone Numbers ─────────────────────────────────────────────

function PhoneNumbersTab() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['whatsapp-phone-numbers'],
    queryFn: () => api.whatsappPhoneNumbers(),
  })

  const numbers = data?.data ?? []

  if (isLoading) return <div className="text-sm text-muted-foreground">Loading phone numbers...</div>
  if (error) return <div className="text-sm text-red-400">Failed to load. Is WhatsApp configured?</div>

  return (
    <div className="space-y-2">
      {numbers.length === 0 && <div className="text-sm text-muted-foreground">No phone numbers found. Configure WhatsApp credentials first.</div>}
      {numbers.map((phone: any) => (
        <div key={phone.id} className="bg-muted/30 rounded-lg px-3 py-2">
          <div className="text-sm font-medium">{phone.display_phone_number || phone.verified_name}</div>
          <div className="flex gap-3 text-xs text-muted-foreground mt-1">
            {phone.verified_name && <span>{phone.verified_name}</span>}
            {phone.quality_rating && (
              <span className={`px-1.5 rounded ${phone.quality_rating === 'GREEN' ? 'bg-green-500/20 text-green-400' : phone.quality_rating === 'YELLOW' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-red-500/20 text-red-400'}`}>
                {phone.quality_rating}
              </span>
            )}
            {phone.platform_type && <span>{phone.platform_type}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}
