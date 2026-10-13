"use client";
import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
export const HISTORY_PAGE_SIZE = 20;
export function useHistoryPage<T>(path: string, page: number, onSessionExpired: () => void) {
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{ key: string; rows: T[]; hasMore: boolean; error: string } | null>(null);
  const key = `${path}:${page}:${reload}`;
  useEffect(() => {
    const abort = new AbortController();
    const separator = path.includes("?") ? "&" : "?";
    // One extra row tells me whether Next leads anywhere; balances never come from this page's sum.
    api<T[]>(`${path}${separator}limit=${HISTORY_PAGE_SIZE + 1}&offset=${page * HISTORY_PAGE_SIZE}`, { signal: abort.signal })
      .then(rows => { if (!abort.signal.aborted) setResult({ key, rows: rows.slice(0, HISTORY_PAGE_SIZE), hasMore: rows.length > HISTORY_PAGE_SIZE, error: "" }); })
      .catch(err => {
        if (abort.signal.aborted) return;
        if (err instanceof ApiError && [401, 403].includes(err.status)) { onSessionExpired(); return; }
        setResult({ key, rows: [], hasMore: false, error: (err as Error).message });
      });
    return () => abort.abort();
  }, [path, page, key, onSessionExpired]);
  return { rows: result?.key === key ? result.rows : [], hasMore: result?.key === key && result.hasMore,
    error: result?.key === key ? result.error : "", loading: result?.key !== key, retry: () => setReload(value => value + 1) };
}
