import { useEffect, useState, useRef } from 'react';

export interface ImportProgress {
  import_id: number;
  processed: number;
  total: number;
  percent: number;
  status: 'processing' | 'complete' | 'cancelled';
}

export function useImportProgress(importId: number | null) {
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!importId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws.current = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.current.onmessage = (event) => {
      let data: any;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      if (data.import_id !== importId) return;

      if (data.type === 'bulk_import_progress') {
        setProgress({ ...data, status: 'processing' });
      } else if (data.type === 'bulk_import_complete') {
        setProgress({ ...data, status: 'complete' });
      } else if (data.type === 'bulk_import_cancelled') {
        setProgress({ ...data, status: 'cancelled' });
      }
    };

    ws.current.onclose = () => {};
    ws.current.onerror = () => ws.current?.close();

    return () => ws.current?.close();
  }, [importId]);

  return progress;
}
