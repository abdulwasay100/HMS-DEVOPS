"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "@/lib/api";
import type { PageMeta } from "@/lib/types";

type Query = Record<string, string | number | boolean | undefined | null>;

interface FetchState<T> {
  data: T | undefined;
  meta: PageMeta | undefined;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Fetches `path` whenever it or the query changes. Pass `enabled: false` to skip.
 * Stale responses from earlier requests are ignored.
 */
export function useFetch<T>(path: string, query?: Query, enabled = true): FetchState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [meta, setMeta] = useState<PageMeta | undefined>(undefined);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const requestId = useRef(0);

  const queryKey = JSON.stringify(query ?? {});
  const requestKey = `${path}|${queryKey}|${tick}`;

  useEffect(() => {
    if (!enabled) return;
    const id = ++requestId.current;
    api
      .get<T>(path, JSON.parse(queryKey) as Query)
      .then((res) => {
        if (id !== requestId.current) return;
        setData(res.data);
        setMeta(res.meta);
        setError(null);
      })
      .catch((err) => {
        if (id !== requestId.current) return;
        setError(errorMessage(err));
      })
      .finally(() => {
        if (id === requestId.current) setSettledKey(`${path}|${queryKey}|${tick}`);
      });
  }, [path, queryKey, enabled, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, meta, loading: enabled && settledKey !== requestKey, error, reload };
}

export function useDebounce<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
