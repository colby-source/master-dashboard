import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { Plus, LayoutList, Columns3, Calendar, User } from 'lucide-react';

interface Props {
  companyId?: number;
}

export function TasksPanel({ companyId }: Props) {
  const [view, setView] = useState<'table' | 'kanban'>('table');
  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPriority, setNewPriority] = useState('medium');
  const [newDueDate, setNewDueDate] = useState('');
  const [newAssignee, setNewAssignee] = useState('');
  const queryClient = useQueryClient();

  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks', companyId],
    queryFn: () => api.getTasks(companyId ? { company_id: String(companyId) } : undefined),
  });

  const createMutation = useMutation({
    mutationFn: (task: any) => api.createTask(task),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setNewTitle('');
      setNewDueDate('');
      setNewAssignee('');
      setShowForm(false);
      toast.success('Task created');
    },
    onError: () => toast.error('Failed to create task'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: number; updates: any }) => api.updateTask(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast.success('Task updated');
    },
    onError: () => toast.error('Failed to update task'),
  });

  const priorityColors: Record<string, string> = {
    urgent: 'text-red-400',
    high: 'text-orange-400',
    medium: 'text-yellow-400',
    low: 'text-gray-400',
  };

  const statusColumns = ['todo', 'in_progress', 'done'];
  const statusLabels: Record<string, string> = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' };

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-lg">Tasks</h3>
        <div className="flex items-center gap-2">
          <div className="flex bg-muted rounded-md p-0.5">
            <button onClick={() => setView('table')} className={`p-1.5 rounded ${view === 'table' ? 'bg-card' : ''}`}>
              <LayoutList className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => setView('kanban')} className={`p-1.5 rounded ${view === 'kanban' ? 'bg-card' : ''}`}>
              <Columns3 className="h-3.5 w-3.5" />
            </button>
          </div>
          <button onClick={() => setShowForm(true)} className="flex items-center gap-1 px-2 py-1.5 bg-accent text-white rounded-md text-sm hover:bg-accent/90">
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
      </div>

      {showForm && (
        <div className="mb-4 p-3 bg-muted rounded-lg space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Task title..."
              className="flex-1 bg-card border border-border rounded-md px-3 py-1.5 text-sm focus:outline-none focus:border-accent"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newTitle.trim()) {
                  createMutation.mutate({ title: newTitle, priority: newPriority, due_date: newDueDate || undefined, assignee: newAssignee || undefined, company_id: companyId });
                }
              }}
            />
            <select value={newPriority} onChange={(e) => setNewPriority(e.target.value)} className="bg-card border border-border rounded-md px-2 py-1.5 text-sm">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div className="flex gap-2">
            <div className="flex items-center gap-1.5 flex-1">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} className="bg-card border border-border rounded-md px-2 py-1 text-sm flex-1 focus:outline-none" />
            </div>
            <div className="flex items-center gap-1.5 flex-1">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              <input type="text" value={newAssignee} onChange={(e) => setNewAssignee(e.target.value)} placeholder="Assignee..." className="bg-card border border-border rounded-md px-2 py-1 text-sm flex-1 focus:outline-none" />
            </div>
            <button onClick={() => { if (newTitle.trim()) createMutation.mutate({ title: newTitle, priority: newPriority, due_date: newDueDate || undefined, assignee: newAssignee || undefined, company_id: companyId }); }} className="px-3 py-1.5 bg-accent text-white rounded-md text-sm">Save</button>
            <button onClick={() => setShowForm(false)} className="px-3 py-1.5 bg-muted-foreground/20 rounded-md text-sm">Cancel</button>
          </div>
        </div>
      )}

      {view === 'table' ? (
        <div className="space-y-1">
          {tasks.length === 0 ? (
            <div className="text-muted-foreground text-sm text-center py-6">No tasks yet</div>
          ) : (
            tasks.map((task: any) => (
              <div key={task.id} className="flex items-center gap-3 p-2 rounded hover:bg-muted/50 group">
                <button
                  onClick={() => updateMutation.mutate({ id: task.id, updates: { status: task.status === 'done' ? 'todo' : 'done' } })}
                  className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${task.status === 'done' ? 'bg-green-500 border-green-500' : 'border-border hover:border-accent'}`}
                >
                  {task.status === 'done' && <span className="text-white text-xs">&#10003;</span>}
                </button>
                <span className={`flex-1 text-sm ${task.status === 'done' ? 'line-through text-muted-foreground' : ''}`}>{task.title}</span>
                {task.due_date && (
                  <span className={`text-xs flex items-center gap-1 ${new Date(task.due_date) < new Date() && task.status !== 'done' ? 'text-red-400' : 'text-muted-foreground'}`}>
                    <Calendar className="h-3 w-3" />
                    {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                )}
                {task.assignee && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <User className="h-3 w-3" />
                    {task.assignee}
                  </span>
                )}
                <span className={`text-xs font-medium ${priorityColors[task.priority]}`}>{task.priority}</span>
                {task.company_name && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: task.company_color }} />
                    {task.company_name}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {statusColumns.map((status) => (
            <div key={status}>
              <div className="text-xs font-medium text-muted-foreground uppercase mb-2">{statusLabels[status]}</div>
              <div className="space-y-2">
                {tasks.filter((t: any) => t.status === status).map((task: any) => (
                  <div
                    key={task.id}
                    className="p-2 bg-muted rounded-lg text-sm cursor-pointer hover:bg-muted/80"
                    onClick={() => {
                      const nextStatus = status === 'todo' ? 'in_progress' : status === 'in_progress' ? 'done' : 'todo';
                      updateMutation.mutate({ id: task.id, updates: { status: nextStatus } });
                    }}
                  >
                    <div className="font-medium">{task.title}</div>
                    <div className={`text-xs mt-1 ${priorityColors[task.priority]}`}>{task.priority}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
