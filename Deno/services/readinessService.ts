export interface ReadinessProbe {
  check(): Promise<boolean>;
}

export function createReadinessProbe(options: {
  query: () => Promise<unknown>;
  cacheMs?: number;
  timeoutMs?: number;
  now?: () => number;
  onError?: (error: unknown) => void;
}): ReadinessProbe {
  const cacheMs = options.cacheMs ?? 2_000;
  const timeoutMs = options.timeoutMs ?? 2_000;
  const now = options.now ?? Date.now;
  let cached: { checkedAt: number; ready: boolean } | null = null;
  let activeQuery: Promise<boolean> | null = null;

  function startQuery() {
    if (activeQuery) return activeQuery;
    const query = (async () => {
      try {
        await options.query();
        cached = { checkedAt: now(), ready: true };
        return true;
      } catch (error) {
        options.onError?.(error);
        cached = { checkedAt: now(), ready: false };
        return false;
      } finally {
        activeQuery = null;
      }
    })();
    activeQuery = query;
    return query;
  }

  return {
    async check() {
      if (cached && now() - cached.checkedAt < cacheMs) return cached.ready;
      const query = startQuery();
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<boolean>((resolve) => {
        timeoutId = setTimeout(() => resolve(false), timeoutMs);
      });
      const ready = await Promise.race([query, timeout]);
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (!ready && activeQuery === query) cached = { checkedAt: now(), ready: false };
      return ready;
    },
  };
}
