"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/SessionProvider";
import { AccountAdjustments, topUpStorageKey, type PendingTopUp } from "@/components/AccountAdjustments";
import { api, ApiError, type Student } from "@/lib/api";
export default function Accounts() {
  const { session, setSession } = useSession();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingTopUp | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [result, setResult] = useState<{ key: string; rows: Student[]; more: boolean; error: string } | null>(null);
  const expired = useCallback(() => { setSession(null); router.replace("/sign-in"); }, [setSession, router]);
  useEffect(() => {
    if (!session) return;
    try {
      const raw = sessionStorage.getItem(topUpStorageKey(session.id));
      if (raw) {
        const value = JSON.parse(raw) as PendingTopUp;
        if (!Number.isSafeInteger(value.studentId) || value.studentId < 1 || typeof value.name !== "string" || typeof value.roll !== "string" || !Number.isSafeInteger(value.body?.amount) || value.body.amount < 1 || typeof value.body.reference !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(value.body.request_key)) throw new Error("Invalid saved request");
        setPending(value); setSelected(value.studentId);
      }
      setStorageReady(true);
    } catch { setStorageError("The saved top-up could not be read. Ask the accounts administrator to reconcile recent receipts before clearing browser data. New top-ups are blocked to avoid duplicates."); }
  }, [session]);
  const path = `/admin/students?status=all&limit=21&offset=${page * 20}&q=${encodeURIComponent(query)}`;
  const key = `${path}:${reload}`;
  useEffect(() => {
    const abort = new AbortController();
    api<Student[]>(path, { signal: abort.signal }).then(rows => { if (!abort.signal.aborted) setResult({ key, rows: rows.slice(0, 20), more: rows.length > 20, error: "" }); }).catch(err => {
      if (abort.signal.aborted) return;
      if (err instanceof ApiError && [401, 403].includes(err.status)) expired(); else setResult({ key, rows: [], more: false, error: (err as Error).message });
    });
    return () => abort.abort();
  }, [path, key, expired]);
  function find(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setQuery(search.trim()); setPage(0); }
  const loading = result?.key !== key;
  return <main id="main" className="admin-students"><div className="admin-page-heading"><div><p className="eyebrow">COLLEGE ACCOUNTS OFFICE</p><h1>Wallet & credit</h1><p>Record wallet payments and manage student credit limits.</p></div></div>
    {storageError && <p className="form-error" role="alert">{storageError}</p>}
    {!pending && <><form className="student-search" onSubmit={find}><label className="field"><span>Find an account</span><input type="search" maxLength={120} value={search} onChange={event => setSearch(event.target.value)} placeholder="Student name or roll number" /></label><button className="primary-button">Search</button></form>
    {loading ? <p className="history-message" role="status">Loading accounts…</p> : result.error ? <div role="alert" className="form-error">{result.error}<button className="text-button" onClick={() => setReload(value => value + 1)}>Retry account search</button></div> : <div className="account-picker" aria-label="Student accounts">{!result.rows.length ? <p>No matching accounts.</p> : result.rows.map(student => <button key={student.id} disabled={!storageReady} aria-pressed={selected === student.id} onClick={() => setSelected(student.id)}><strong>{student.name}</strong><span>{student.roll_no} · {student.approval_status} · {student.is_active ? "Enabled" : "Suspended"}</span></button>)}</div>}
    {(page > 0 || !loading && result.more) && <nav className="history-pagination" aria-label="Account pages"><button className="secondary-button" disabled={loading || page === 0} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page + 1}</span><button className="secondary-button" disabled={loading || !result?.more} onClick={() => setPage(value => value + 1)}>Next</button></nav>}</>}
    {storageReady && selected !== null ? <AccountAdjustments key={selected} studentId={selected} pending={pending} setPending={setPending} expired={expired} /> : !storageError && <p className="history-message">Select a student to view balances and record account changes.</p>}
  </main>;
}
