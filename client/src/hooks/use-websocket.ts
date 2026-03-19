import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export function useWebSocket() {
  const queryClient = useQueryClient();
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws.current = new WebSocket(`${protocol}//${window.location.host}/ws`);

      ws.current.onmessage = (event) => {
        let data: any;
        try {
          data = JSON.parse(event.data);
        } catch {
          console.warn('[WS] Failed to parse message:', event.data);
          return;
        }
        if (data.type === 'sync_complete') {
          queryClient.invalidateQueries();
        }
        if (data.type === 'alert') {
          queryClient.invalidateQueries({ queryKey: ['alerts'] });
        }
        if (data.type === 'bulk_import_complete') {
          queryClient.invalidateQueries({ queryKey: ['enrichment'] });
        }
      };

      ws.current.onclose = () => {
        setTimeout(connect, 3000);
      };

      ws.current.onerror = () => {
        ws.current?.close();
      };
    };

    connect();
    return () => ws.current?.close();
  }, [queryClient]);
}
