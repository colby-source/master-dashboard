import { useState } from 'react'
import { XCircle, Plus } from 'lucide-react'

interface Props {
  tags: string[]
  onUpdateTags: (tags: string[]) => void
}

export function TagEditor({ tags, onUpdateTags }: Props) {
  const [input, setInput] = useState('')

  function addTag(raw: string) {
    const tag = raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '')
    if (!tag || tags.includes(tag)) return
    onUpdateTags([...tags, tag])
  }

  function removeTag(tag: string) {
    onUpdateTags(tags.filter(t => t !== tag))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (input.trim()) {
        addTag(input)
        setInput('')
      }
    }
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {tags.map(tag => (
          <span key={tag} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-accent/10 text-accent text-xs rounded">
            {tag}
            <button onClick={() => removeTag(tag)} className="hover:text-red-400">
              <XCircle className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add tag..."
          className="bg-muted border border-border rounded px-2 py-0.5 text-xs w-32"
        />
        <button
          onClick={() => { if (input.trim()) { addTag(input); setInput(''); } }}
          className="p-0.5 rounded hover:bg-accent/20"
          title="Add tag"
        >
          <Plus className="h-3.5 w-3.5 text-accent" />
        </button>
      </div>
    </div>
  )
}
