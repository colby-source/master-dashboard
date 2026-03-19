import { useState, useRef, useEffect, useCallback } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import {
  Send,
  Bot,
  User,
  Loader2,
  Trash2,
  Zap,
  ChevronRight,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"

interface AssistantMessage {
  id?: number
  role: "user" | "assistant"
  content: string
  actions?: { tool: string; summary: string }[]
  navigation?: string
  timestamp?: string
}

const SUGGESTIONS = [
  "Show me all hot leads",
  "What campaigns are active?",
  "Create a task to follow up with new leads",
  "Show me the dashboard summary",
  "How many contacts were enriched today?",
  "Show open tasks",
  "What are my latest alerts?",
  "Show competitor updates",
]

export default function AiAssistantPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [input, setInput] = useState("")
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [conversationId] = useState(
    () => `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  )
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Load history
  const { data: _history } = useQuery({
    queryKey: ["assistant-history", conversationId],
    queryFn: () => api.getAssistantHistory(conversationId),
    enabled: false, // Only load on explicit request
  })

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Chat mutation
  const chatMutation = useMutation({
    mutationFn: (message: string) =>
      api.assistantChat(message, conversationId),
    onSuccess: (data: any) => {
      const assistantMsg: AssistantMessage = {
        role: "assistant",
        content: data.response || "I couldn't generate a response.",
        actions: data.actions || [],
        navigation: data.navigation,
        timestamp: new Date().toISOString(),
      }
      setMessages((prev) => [...prev, assistantMsg])

      // Handle navigation
      if (data.navigation) {
        setTimeout(() => {
          navigate(data.navigation)
        }, 1500)
      }

      // Invalidate relevant queries after AI actions
      if (data.actions?.length > 0) {
        queryClient.invalidateQueries({ queryKey: ["summary"] })
        queryClient.invalidateQueries({ queryKey: ["tasks"] })
        queryClient.invalidateQueries({ queryKey: ["alerts"] })
        queryClient.invalidateQueries({ queryKey: ["campaigns"] })
        queryClient.invalidateQueries({ queryKey: ["enrichment-leads"] })
      }
    },
    onError: (err: any) => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Error: ${err.message || "Something went wrong. Please try again."}`,
          timestamp: new Date().toISOString(),
        },
      ])
    },
  })

  const handleSend = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || chatMutation.isPending) return

    const userMsg: AssistantMessage = {
      role: "user",
      content: trimmed,
      timestamp: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMsg])
    setInput("")
    chatMutation.mutate(trimmed)
  }, [input, chatMutation])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleClear = () => {
    setMessages([])
    api.clearAssistantHistory(conversationId)
  }

  const handleSuggestion = (text: string) => {
    setInput(text)
    inputRef.current?.focus()
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            AI Assistant
          </h1>
          <p className="text-sm text-muted-foreground">
            Control the entire dashboard with natural language
          </p>
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="text-muted-foreground"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Messages area */}
      <ScrollArea className="flex-1 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Bot className="h-12 w-12 text-muted-foreground/30 mb-4" />
            <h2 className="text-lg font-medium mb-2">
              What can I help you with?
            </h2>
            <p className="text-sm text-muted-foreground mb-6 max-w-md">
              I can search contacts, manage campaigns, create tasks, check
              alerts, run enrichments, and navigate the dashboard — all from
              natural language.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg w-full">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSuggestion(s)}
                  className="text-left text-sm px-3 py-2 rounded-lg border border-border hover:bg-accent/50 transition-colors flex items-center gap-2"
                >
                  <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4 max-w-3xl mx-auto">
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`flex gap-3 ${
                  msg.role === "user" ? "justify-end" : ""
                }`}
              >
                {msg.role === "assistant" && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-2xl rounded-br-md px-4 py-2"
                      : "space-y-2"
                  }`}
                >
                  {/* Message content */}
                  <div
                    className={
                      msg.role === "assistant"
                        ? "bg-card border border-border rounded-2xl rounded-bl-md px-4 py-3 text-sm whitespace-pre-wrap"
                        : "text-sm"
                    }
                  >
                    {msg.content}
                  </div>

                  {/* Actions taken */}
                  {msg.actions && msg.actions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {msg.actions.map((action, j) => (
                        <Badge
                          key={j}
                          variant="secondary"
                          className="text-xs"
                        >
                          <Zap className="h-3 w-3 mr-1" />
                          {action.summary || action.tool}
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Navigation indicator */}
                  {msg.navigation && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <ChevronRight className="h-3 w-3" />
                      Navigating to {msg.navigation}...
                    </div>
                  )}
                </div>
                {msg.role === "user" && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                    <User className="h-4 w-4" />
                  </div>
                )}
              </div>
            ))}

            {/* Loading indicator */}
            {chatMutation.isPending && (
              <div className="flex gap-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
                <div className="bg-card border border-border rounded-2xl rounded-bl-md px-4 py-3 text-sm">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Thinking...
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {/* Input area */}
      <div className="border-t border-border pt-4">
        <div className="max-w-3xl mx-auto flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me anything about your dashboard..."
            rows={1}
            className="flex-1 resize-none rounded-lg border border-border bg-background px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={chatMutation.isPending}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || chatMutation.isPending}
            size="icon"
            className="h-auto aspect-square"
          >
            {chatMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground text-center mt-2">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  )
}
