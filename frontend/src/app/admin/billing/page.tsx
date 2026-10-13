"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, nepalTime, rupees } from "@/lib/api";
import { readPendingSettlement, settlementKey, type Dues, type PendingSettlement, type Settlement } from "@/lib/billing";
import { useSession } from "@/components/SessionProvider";
import { SettlementReview } from "@/components/SettlementReview";
import { SettlementHistory } from "@/components/SettlementHistory";
export default function Billing() {
  const { session, setSession } = useSession();
  const router = useRouter();
  const [monthInput, setMonthInput] = useState("");
  const [month, setMonth] = useState("");
  const [search, setSearch] = useState("");
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{ key: string; rows: Dues[]; error: string } | null>(null);
  const [draft, setDraft] = useState<PendingSettlement | null>(null);
  const [pending, setPending] = useState<PendingSettlement | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [receipt, setReceipt] = useState<{ value: Settlement; label: string } | null>(null);
  const [historyStudent, setHistoryStudent] = useState<{ id: number; label: string } | null>(null);
  const writing = useRef(false);
  const downloading = useRef(false);
  const mounted = useRef(true);
  const expired = useCallback(() => { setSession(null); router.replace("/sign-in"); }, [setSession, router]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!session) return;
    try { setPending(readPendingSettlement(session.id)); setStorageReady(true); }
    catch { setStorageError("The saved settlement could not be read. Reconcile recent receipts with the accounts administrator before clearing browser data. New settlements are blocked to avoid duplicate records."); }
  }, [session]);
  const path = `/admin/billing/outstanding${month ? `?month=${month}` : ""}`;
  const key = `${path}:${reload}`;
  useEffect(() => {
    const abort = new AbortController();
    api<Dues[]>(path, { signal: abort.signal }).then(rows => { if (!abort.signal.aborted) setResult({ key, rows, error: "" }); }).catch(err => {
      if (abort.signal.aborted) return;
      if (err instanceof ApiError && [401, 403].includes(err.status)) expired(); else setResult({ key, rows: [], error: (err as Error).message });
    });
    return () => abort.abort();
  }, [path, key, expired]);
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (monthInput && !/^[1-9][0-9]{3}-(0[1-9]|1[0-2])$/.test(monthInput)) { setError("Choose a valid month."); return; }
    setError(""); setMonth(monthInput); setReload(value => value + 1);
  }
  function review(row: Dues) {
    setError(""); setReceipt(null);
    setDraft({ name: row.name, roll: row.roll_no, month: row.month, body: { request_key: crypto.randomUUID(), student_id: row.student_id, ledger_ids: [...row.ledger_ids], expected_amount: row.amount, reference: "" } });
  }
  async function settle(request: PendingSettlement) {
    if (!session || writing.current) return;
    try { sessionStorage.setItem(settlementKey(session.id), JSON.stringify(request)); }
    catch { setError("Browser storage is unavailable. No settlement was sent. Enable storage before continuing."); return; }
    setPending(request); setDraft(null); setError(""); writing.current = true; setBusy(true);
    try {
      const value = await api<Settlement>("/admin/billing/settlements", { method: "POST", body: JSON.stringify(request.body), signal: AbortSignal.timeout(30000) }, session.csrf_token);
      sessionStorage.removeItem(settlementKey(session.id));
      if (mounted.current) {
        setPending(null); setReceipt({ value, label: `${request.name} · ${request.roll}` });
        setHistoryStudent({ id: value.student_id, label: `${request.name} · ${request.roll}` }); setReload(value => value + 1);
      }
    } catch (err) {
      if (!mounted.current) return;
      if (err instanceof ApiError && [401, 403].includes(err.status)) { expired(); return; }
      const rejected = err instanceof ApiError && ([404, 422].includes(err.status) || err.status === 409 && !err.message.includes("request key"));
      if (rejected) {
        try { sessionStorage.removeItem(settlementKey(session.id)); setPending(null); } catch { /* Preserve recovery if storage is unavailable. */ }
        setError((err as Error).message); setReload(value => value + 1);
      } else setError("The settlement result is unconfirmed. Retry the saved request to recover the original receipt.");
    } finally { writing.current = false; if (mounted.current) setBusy(false); }
  }
  async function download() {
    if (downloading.current) return;
    downloading.current = true; setExporting(true); setError("");
    try {
      const response = await fetch(`/api/admin/billing/outstanding.csv${month ? `?month=${month}` : ""}`, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(30000) });
      if ([401, 403].includes(response.status)) { expired(); return; }
      if (!response.ok) throw new Error("The CSV could not be exported. Try again.");
      const blob = await response.blob();
      if (!mounted.current) return;
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = `campusdine-dues-${month || "all"}.csv`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { if (mounted.current) setError("The CSV could not be exported. Check your connection and try again."); }
    finally { downloading.current = false; if (mounted.current) setExporting(false); }
  }
  const loading = result?.key !== key;
  const rows = loading ? [] : result.rows.filter(row => `${row.name} ${row.roll_no}`.toLowerCase().includes(search.trim().toLowerCase()));
  const blocked = busy || !!pending || !!draft || !storageReady;
  const currentReview = pending ?? draft;
  return <main id="main" className="admin-students"><div className="admin-page-heading"><div><p className="eyebrow">COLLEGE ACCOUNTS OFFICE</p><h1>Billing & settlements</h1><p>Review outstanding credit and record verified accounts transfers.</p></div><button className="primary-button" disabled={loading || !!result?.error || exporting || blocked} onClick={() => void download()}>{exporting ? "Preparing CSV…" : "Export dues CSV"}</button></div>
    {storageError && <p role="alert" className="form-error">{storageError}</p>}
    {error && !currentReview && <p role="alert" className="form-error">{error}</p>}
    {receipt && <div role="status" className="admin-success"><strong>Settlement recorded · {receipt.label}</strong><p>{rupees(receipt.value.amount)} · {receipt.value.reference} · {nepalTime(receipt.value.created_at)}</p><p>{receipt.value.ledger_ids.length} entries settled. Wallet unchanged.</p><details><summary>Receipt details</summary><p className="ledger-ids">{receipt.value.request_key}</p></details></div>}
    <div className="billing-filters"><form className="student-search" onSubmit={filter}><label className="field"><span>Billing month</span><input type="month" value={monthInput} onChange={event => setMonthInput(event.target.value)} disabled={blocked} /></label><button className="secondary-button" disabled={blocked}>Apply month</button><button type="button" className="text-button" disabled={blocked} onClick={() => { setMonth(""); setMonthInput(""); setReload(value => value + 1); }}>All months</button></form><label className="field"><span>Find dues</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Student name or roll number" disabled={blocked} /></label></div>
    <p className="history-footnote">Showing {month || "all months"}. The CSV contains the latest dues for this period, including suspended accounts. The name filter affects only this screen.</p>
    <div className="billing-totals"><div><span>Visible outstanding dues</span><strong>{loading || result?.error ? "—" : rupees(rows.reduce((sum, row) => sum + row.amount, 0))}</strong></div><div><span>Student-month records</span><strong>{loading || result?.error ? "—" : rows.length}</strong></div><button className="secondary-button" disabled={blocked || loading} onClick={() => setReload(value => value + 1)}>Reload dues</button></div>
    {loading ? <p className="history-message" role="status">Loading outstanding dues…</p> : result.error ? <div className="form-error" role="alert">{result.error}<button className="text-button" onClick={() => setReload(value => value + 1)}>Retry dues</button></div> : !rows.length ? <div className="history-message"><h2>{search ? "No dues match your search." : "No outstanding dues for this period."}</h2><p>Recorded settlements remain available in the history below.</p></div> : <div className="history-table-wrap"><table className="history-table billing-table"><caption className="sr-only">Outstanding credit by student and month</caption><thead><tr><th scope="col">Student</th><th scope="col">Month</th><th scope="col">Entries</th><th scope="col">Outstanding</th><th scope="col">Actions</th></tr></thead><tbody>{rows.map(row => <tr key={`${row.student_id}-${row.month}`}><th scope="row" data-label="Student"><strong>{row.name}</strong><small>{row.roll_no} · {row.department}</small></th><td data-label="Month">{row.month}</td><td data-label="Entries">{row.ledger_ids.length}</td><td data-label="Outstanding">{rupees(row.amount)}</td><td data-label="Actions"><button className="review-student-button" aria-label={`Settle ${row.roll_no} ${row.month}`} disabled={blocked || row.ledger_ids.length > 500 || row.amount > 2147483647} onClick={() => review(row)}>Review settlement →</button><button className="text-button" aria-label={`History ${row.roll_no}`} disabled={blocked} onClick={() => setHistoryStudent({ id: row.student_id, label: `${row.name} · ${row.roll_no}` })}>History</button>{(row.ledger_ids.length > 500 || row.amount > 2147483647) && <small>This group exceeds the single-settlement limit. Ask accounts to reconcile smaller batches.</small>}</td></tr>)}</tbody></table></div>}
    <p className="history-footnote">Settle one student-month group at a time after verifying its transfer reference. This records an accounts transfer; it does not collect money or send it to a bank.</p>
    <SettlementHistory key={`${historyStudent?.id ?? "all"}-${reload}`} student={historyStudent} expired={expired} clear={() => setHistoryStudent(null)} />
    {currentReview && <SettlementReview key={currentReview.body.request_key} request={currentReview} pending={!!pending} busy={busy} error={error} close={() => { setDraft(null); setError(""); }} submit={request => void settle(request)} />}
  </main>;
}
