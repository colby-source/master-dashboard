import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { BarChart3 } from 'lucide-react';
import { Skeleton } from '../ui/skeleton';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';

const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4', '#f97316'];
const STATUS_COLORS: Record<string, string> = {
  todo: '#6b7280',
  in_progress: '#3b82f6',
  done: '#10b981',
};
const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  warning: '#f59e0b',
  info: '#3b82f6',
};

export function ChartsPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['chart-data'],
    queryFn: api.getChartData,
    refetchInterval: 60000,
  });

  if (isLoading || !data) {
    return (
      <div className="bg-card border border-border rounded-lg p-5">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="h-5 w-5 text-blue-400" />
          <h3 className="font-semibold text-lg">Analytics</h3>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-[220px] w-full rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const { campaigns, taskStats, alertStats, agents } = data;

  const hasData = campaigns.length > 0 || taskStats.length > 0 || alertStats.length > 0 || agents.length > 0;

  if (!hasData) {
    return (
      <div className="bg-card border border-border rounded-lg p-5">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="h-5 w-5 text-blue-400" />
          <h3 className="font-semibold text-lg">Analytics</h3>
        </div>
        <div className="text-center py-8">
          <BarChart3 className="mx-auto size-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">No analytics data yet. Charts will appear once campaigns are active and data starts flowing.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 className="h-5 w-5 text-blue-400" />
        <h3 className="font-semibold text-lg">Analytics</h3>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Campaign Performance */}
        {campaigns.length > 0 && (
          <div>
            <div className="text-sm font-medium text-muted-foreground mb-3">Campaign Performance (%)</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={campaigns.slice(0, 10)} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#9ca3af' }} interval={0} angle={-30} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e1e2e', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: '#fff' }}
                />
                <Bar dataKey="open_rate" name="Open %" fill="#3b82f6" radius={[2, 2, 0, 0]} />
                <Bar dataKey="reply_rate" name="Reply %" fill="#8b5cf6" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Task Distribution */}
        {taskStats.length > 0 && (
          <div>
            <div className="text-sm font-medium text-muted-foreground mb-3">Task Distribution</div>
            <div className="flex items-center justify-center">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={taskStats}
                    dataKey="count"
                    nameKey="status"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    innerRadius={45}
                    paddingAngle={3}
                    label={({ payload }: any) => `${payload?.status || ''} (${payload?.count || 0})`}
                  >
                    {taskStats.map((entry: any, i: number) => (
                      <Cell key={i} fill={STATUS_COLORS[entry.status] || COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1e1e2e', border: '1px solid #333', borderRadius: 8, fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Agent Health Radar */}
        {agents.length > 0 && (
          <div>
            <div className="text-sm font-medium text-muted-foreground mb-3">Agent Health</div>
            <ResponsiveContainer width="100%" height={220}>
              <RadarChart data={agents.map((a: any) => ({ name: a.name.length > 15 ? a.name.slice(0, 15) + '...' : a.name, success_rate: a.success_rate }))}>
                <PolarGrid stroke="#333" />
                <PolarAngleAxis dataKey="name" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 9, fill: '#6b7280' }} />
                <Radar dataKey="success_rate" stroke="#10b981" fill="#10b981" fillOpacity={0.2} />
                <Tooltip contentStyle={{ backgroundColor: '#1e1e2e', border: '1px solid #333', borderRadius: 8, fontSize: 12 }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Alert Severity */}
        {alertStats.length > 0 && (
          <div>
            <div className="text-sm font-medium text-muted-foreground mb-3">Alerts by Severity (7 days)</div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={alertStats} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 60 }}>
                <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                <YAxis type="category" dataKey="severity" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <Tooltip contentStyle={{ backgroundColor: '#1e1e2e', border: '1px solid #333', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="count" name="Count" radius={[0, 4, 4, 0]}>
                  {alertStats.map((entry: any, i: number) => (
                    <Cell key={i} fill={SEVERITY_COLORS[entry.severity] || COLORS[i]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}
