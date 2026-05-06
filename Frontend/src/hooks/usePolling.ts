import { useEffect, useRef, useState } from 'react';

type PollingState<T> = {
  data: T | null;
  error: string;
  loading: boolean;
  refresh: () => void;
};

type Options = {
  intervalMs: number;
  enabled?: boolean;
};

export function usePolling<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: ReadonlyArray<unknown>,
  options: Options,
): PollingState<T> {
  const { intervalMs, enabled = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);

  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      try {
        const next = await fetcherRef.current(controller.signal);
        if (!cancelled) {
          setData(next);
          setError('');
        }
      } catch (err) {
        if (cancelled || controller.signal.aborted) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Unexpected error');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();

    const timer = window.setInterval(() => {
      void run();
    }, intervalMs);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, intervalMs, tick]);

  return {
    data,
    error,
    loading,
    refresh: () => setTick((value) => value + 1),
  };
}
