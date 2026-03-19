import { useState } from 'react'
import { Tag, Plus, Minus, RefreshCw } from 'lucide-react'

interface Props {
  selectedCount: number
  onBulkUpdateTags: (mode: 'add' | 'remove' | 'replace', tags: string[]) => void
}

export function TagBulkActions({ selectedCount, onBulkUpdateTags }: Props) {
  const [mode, setMode] = useState<'add' | 'remove' | 'replace'>('add')
  const [input, setInput] = useState('')

  function handleApply() {
    const tags = input
      .split(',')
      .map(t => t.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ''))
      .filter(Boolean)
    if (tags.length === 0) return
    onBulkUpdateTags(mode, tags)
    setInput('')
  }

  return (
    <div className="flex items-center gap-2 p-2 bg-purple-500/10 rounded-lg">
      <Tag className="h-3.5 w-3.5 text-purple-400" />
      <span className="text-xs text-purple-400">{selectedCount} selected</span>

      <div className="flex rounded overflow-hidden border border-border">
        <button
          onClick={() => setMode('add')}
          className={`px-2 py-0.5 text-xs flex items-center gap-0.5 ${mode === 'add' ? 'bg-green-600 text-white' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
        >
          <Plus className="h-3 w-3" /> Add
        </button>
        <button
          onClick={() => setMode('remove')}
          className={`px-2 py-0.5 text-xs flex items-center gap-0.5 ${mode === 'remove' ? 'bg-red-600 text-white' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
        >
          <Minus className="h-3 w-3" /> Remove
        </button>
        <button
          onClick={() => setMode('replace')}
          className={`px-2 py-0.5 text-xs flex items-center gap-0.5 ${mode === 'replace' ? 'bg-blue-600 text-white' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
        >
          <RefreshCw className="h-3 w-3" /> Replace
        </button>
      </div>

      <input
        type="text"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleApply() }}
        placeholder="tag1, tag2, ..."
        className="bg-muted border border-border rounded px-2 py-1 text-xs flex-1 max-w-xs"
      />

      <button
        onClick={handleApply}
        disabled={!input.trim()}
        className="px-2 py-1 text-xs rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white"
      >
        Apply
      </button>
    </div>
  )
}
