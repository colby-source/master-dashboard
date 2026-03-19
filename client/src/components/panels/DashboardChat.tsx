import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { toast } from 'sonner';
import { MessageCircle, Send, Loader2, Trash2 } from 'lucide-react';

export function DashboardChat() {
  const [question, setQuestion] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: history = [] } = useQuery({
    queryKey: ['chat-history'],
    queryFn: api.getChatHistory,
  });

  const askMutation = useMutation({
    mutationFn: (q: string) => api.queryDashboard(q),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-history'] });
      setQuestion('');
    },
    onError: () => toast.error('Failed to get response'),
  });

  const clearMutation = useMutation({
    mutationFn: () => api.clearChatHistory(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chat-history'] });
      toast.success('Chat history cleared');
    },
    onError: () => toast.error('Failed to clear history'),
  });

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history, askMutation.isPending]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || askMutation.isPending) return;
    askMutation.mutate(question.trim());
  };

  const suggestions = [
    'How are my campaigns doing this week?',
    'Which agents need attention?',
    'What should I focus on today?',
    'Summarize my open tasks',
  ];

  return (
    <div className="bg-card border border-border rounded-lg p-5 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-cyan-400" />
          <h3 className="font-semibold text-lg">Ask Your Dashboard</h3>
        </div>
        {history.length > 0 && (
          <button
            onClick={() => clearMutation.mutate()}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
            title="Clear history"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 max-h-[350px] overflow-y-auto mb-3">
        {history.length === 0 && !askMutation.isPending && (
          <div className="text-center py-4">
            <div className="text-muted-foreground text-sm mb-3">Ask anything about your business data</div>
            <div className="flex flex-wrap gap-2 justify-center">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => { setQuestion(s); inputRef.current?.focus(); }}
                  className="text-xs bg-muted hover:bg-muted/80 px-3 py-1.5 rounded-full text-muted-foreground hover:text-foreground transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {history.map((msg: any) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-cyan-600/20 text-cyan-100'
                  : 'bg-muted/50 text-foreground'
              }`}
            >
              <div className="whitespace-pre-wrap">{msg.content}</div>
            </div>
          </div>
        ))}

        {askMutation.isPending && (
          <div className="flex justify-start">
            <div className="bg-muted/50 rounded-lg px-3 py-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Analyzing your data...
            </div>
          </div>
        )}
      </div>

      {askMutation.isError && (
        <div className="text-red-400 text-xs mb-2 p-2 bg-red-500/10 rounded">
          {(askMutation.error as Error).message}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about your campaigns, tasks, agents..."
          className="flex-1 bg-muted border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-cyan-500"
        />
        <button
          type="submit"
          disabled={!question.trim() || askMutation.isPending}
          className="px-3 py-2 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white rounded-md transition-colors"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
