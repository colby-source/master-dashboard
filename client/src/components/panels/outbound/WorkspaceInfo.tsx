import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';

export function WorkspaceInfo() {
  const { data } = useQuery({
    queryKey: ['instantly-workspace'],
    queryFn: () => api.instantlyWorkspace(),
    staleTime: 300_000,
  });
  if (!data) return null;
  return (
    <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
      {data.name ?? 'Workspace'}
    </span>
  );
}
