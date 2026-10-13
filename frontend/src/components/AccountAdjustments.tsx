"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError, nepalTime, rupees, type AccountSummary, type Student, type WalletTransaction } from "@/lib/api";
import { useSession } from "./SessionProvider";
import { WalletHistory } from "./WalletHistory";
import { useHistoryPage } from "@/lib/useHistoryPage";
import { HistoryPagination } from "./HistoryPagination";

export type PendingTopUp = { studentId: number; name: string; roll: string; body: { request_key: string; amount: number; reference: string } };
export const topUpStorageKey = (adminId: number) => `campusdine:admin:${adminId}:pending-topup`;
function paisa(text: string, allowZero = false) {
  if (!/^\d+(\.\d{1,2})?$/.test(text.trim())) throw new Error("Enter an NPR amount with at most two decimal places.");
  const [whole, fraction = ""] = text.trim().split(".");
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 2147483647) throw new Error("Amount is outside the supported range.");
  return value;
}
type LimitChange = { id: number; old_limit: number; new_limit: number; reason: string; admin_id: number; changed_at: string };
function LimitHistory({ studentId, expired }: { studentId: number; expired: () => void }) {
  const [page, setPage] = useState(0);
  const history = useHistoryPage<LimitChange>(`/admin/accounts/${studentId}/credit-limit-history`, page, expired);
  return <section className="account-history"><div className="history-heading"><h2>Credit-limit history</h2><span>Dates shown in Nepal time</span></div>
    {history.loading ? <p role="status">Loading limit history…</p> : history.error ? <div role="alert" className="form-error">{history.error}<button className="text-button" onClick={history.retry}>Retry limit history</button></div> : !history.rows.length ? <p className="history-message">No credit-limit changes on this page.</p> : <div className="history-table-wrap"><table className="history-table"><caption className="sr-only">Audited credit-limit changes</caption><thead><tr><th>Change</th><th>Reason</th><th>Recorded by</th><th>Nepal time</th></tr></thead><tbody>{history.rows.map(row => <tr key={row.id}><th scope="row" data-label="Change">{rupees(row.old_limit)} → {rupees(row.new_limit)}</th><td data-label="Reason">{row.reason}</td><td data-label="Recorded by">Admin #{row.admin_id}</td><td data-label="Nepal time">{nepalTime(row.changed_at)}</td></tr>)}</tbody></table></div>}
    <HistoryPagination page={page} hasMore={history.hasMore} loading={history.loading} onPage={setPage} />
  </section>;
}
export function AccountAdjustments({ studentId, pending, setPending, expired }: { studentId: number; pending: PendingTopUp | null; setPending: (value: PendingTopUp | null) => void; expired: () => void }) {
  const { session } = useSession();
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [student, setStudent] = useState<Student | null>(null);
  const [reload, setReload] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<WalletTransaction | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<PendingTopUp | null>(null);
  const [limitDraft, setLimitDraft] = useState<{ credit_limit: number; expected_credit_limit: number; reason: string } | null>(null);
  const writing = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const abort = new AbortController();
    setAccount(null); setLoadError("");
    Promise.all([api<AccountSummary>(`/admin/accounts/${studentId}`, { signal: abort.signal }), api<Student>(`/admin/students/${studentId}`, { signal: abort.signal })]).then(([summary, profile]) => {
      if (!abort.signal.aborted) { setAccount(summary); setStudent(profile); }
    }).catch(err => {
      if (abort.signal.aborted) return;
      if (err instanceof ApiError && [401, 403].includes(err.status)) expired(); else setLoadError((err as Error).message);
    });
    return () => abort.abort();
  }, [studentId, reload, expired]);
  function clearPending() {
    sessionStorage.removeItem(topUpStorageKey(session!.id));
    setPending(null);
  }
  async function sendTopUp(request: PendingTopUp) {
    if (!session || writing.current) return;
    // Persist the exact request before a byte is sent; the same admin can replay it after login.
    try { sessionStorage.setItem(topUpStorageKey(session.id), JSON.stringify(request)); }
    catch { setError("Browser storage is unavailable. No top-up was sent. Enable storage before continuing."); return; }
    setPending(request); setDraft(null); setError(""); setReceipt(null); writing.current = true; setBusy(true);
    try {
      const result = await api<WalletTransaction>(`/admin/accounts/${request.studentId}/top-ups`, { method: "POST", body: JSON.stringify(request.body), signal: AbortSignal.timeout(30000) }, session.csrf_token);
      clearPending();
      if (mounted.current) { setReceipt(result); setReload(value => value + 1); }
    } catch (err) {
      if (!mounted.current) return;
      if (err instanceof ApiError && [401, 403].includes(err.status)) { expired(); return; }
      const rejected = err instanceof ApiError && [404, 422].includes(err.status) || err instanceof ApiError && err.status === 409 && !err.message.includes("request key");
      if (rejected) {
        try { clearPending(); } catch { /* Keep the request locked if storage cannot be cleared. */ }
        setError((err as Error).message); setReload(value => value + 1);
      } else setError("The top-up result is unconfirmed. Retry the saved request to recover its receipt; do not record another payment for it.");
    } finally { writing.current = false; if (mounted.current) setBusy(false); }
  }
  function reviewTopUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!account || pending || writing.current) return;
    const data = new FormData(event.currentTarget); setError(""); setReceipt(null);
    try {
      const amount = paisa(String(data.get("amount")));
      const reference = String(data.get("reference")).trim();
      if (!reference) throw new Error("Enter the receipt reference.");
      setDraft({ studentId, name: account.name, roll: account.roll_no, body: { request_key: crypto.randomUUID(), amount, reference } });
    } catch (err) { setError((err as Error).message); }
  }
  function reviewLimit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!account || pending || writing.current) return;
    const data = new FormData(event.currentTarget); setError(""); setNotice("");
    try {
      const credit_limit = paisa(String(data.get("limit")), true), reason = String(data.get("reason")).trim();
      if (credit_limit < account.credit_balance) throw new Error("The credit limit cannot be lower than outstanding dues.");
      if (credit_limit === account.credit_limit) throw new Error("Enter a different credit limit.");
      if (!reason) throw new Error("Enter a reason for the change.");
      setLimitDraft({ credit_limit, expected_credit_limit: account.credit_limit, reason });
    } catch (err) { setError((err as Error).message); }
  }
  async function saveLimit() {
    if (!session || !limitDraft || writing.current) return;
    writing.current = true; setBusy(true); setError("");
    try {
      await api<AccountSummary>(`/admin/accounts/${studentId}/credit-limit`, { method: "PATCH", body: JSON.stringify(limitDraft), signal: AbortSignal.timeout(30000) }, session.csrf_token);
      if (mounted.current) setNotice("Credit limit updated. Wallet and outstanding dues are unchanged.");
    } catch (err) {
      if (!mounted.current) return;
      if (err instanceof ApiError && [401, 403].includes(err.status)) expired();
      else setError(`${(err as Error).message} Review the refreshed balance and limit history before making another change.`);
    } finally {
      writing.current = false;
      if (mounted.current) { setBusy(false); setLimitDraft(null); setReload(value => value + 1); }
    }
  }
  const locked = busy || !!pending || !!draft || !!limitDraft || !account;
  return <section className="account-adjustments" aria-label="Selected student account">
    {pending && <div className="action-confirmation"><h2>Recover pending top-up</h2><p><strong>{pending.name} · {pending.roll}</strong><br />{rupees(pending.body.amount)} · {pending.body.reference}</p><p>This request may already have been recorded. Retry recovers the same receipt without adding the funds twice. Keep this browser tab until it is resolved.</p><button className="primary-button" disabled={busy} onClick={() => void sendTopUp(pending)}>{busy ? "Checking receipt…" : "Retry saved top-up"}</button></div>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {receipt && <div className="admin-success" role="status"><strong>Top-up recorded · Receipt #{receipt.id}</strong><p>{rupees(receipt.amount)} · {receipt.reference} · {nepalTime(receipt.timestamp)}</p></div>}
    {notice && <p className="admin-success" role="status">{notice}</p>}
    {loadError ? <div className="form-error" role="alert">{loadError}<button className="text-button" onClick={() => setReload(value => value + 1)}>Reload account</button></div> : !account ? <p role="status">Loading account…</p> : <>
      <div className="history-heading"><div><p className="eyebrow">{account.roll_no} · {student?.approval_status} · {student?.is_active ? "Enabled" : "Suspended"}</p><h2>{account.name}</h2></div><button className="secondary-button" disabled={locked} onClick={() => setReload(value => value + 1)}>Reload balances</button></div>
      <dl className="review-balances"><div><dt>Wallet balance</dt><dd>{rupees(account.wallet_balance)}</dd></div><div><dt>Outstanding dues</dt><dd>{rupees(account.credit_balance)}</dd></div><div><dt>Credit limit</dt><dd>{rupees(account.credit_limit)}</dd></div><div><dt>Available credit</dt><dd>{rupees(account.remaining_credit)}</dd></div></dl>
      <div className="adjustment-forms"><form onSubmit={reviewTopUp}><h3>Top up wallet</h3><p>Record funds received by the accounts office. A top-up does not settle credit dues.</p><fieldset className="form-fields" disabled={locked || student?.approval_status !== "approved" || !student?.is_active}><label className="field"><span>Top-up amount (NPR)</span><input name="amount" inputMode="decimal" required placeholder="500.00" /></label><label className="field"><span>Receipt reference</span><input name="reference" maxLength={120} required placeholder="NCE receipt number" /></label><button className="primary-button">Review top-up</button></fieldset>{(student?.approval_status !== "approved" || !student?.is_active) && <p>Top-ups require an active, approved student.</p>}</form>
      <form key={reload} onSubmit={reviewLimit}><h3>Set credit limit</h3><p>The limit must cover existing dues. Setting it to zero disables credit when no dues remain.</p><fieldset className="form-fields" disabled={locked || student?.approval_status !== "approved"}><label className="field"><span>New credit limit (NPR)</span><input name="limit" inputMode="decimal" required defaultValue={(account.credit_limit / 100).toFixed(2)} /></label><label className="field"><span>Reason for change</span><input name="reason" maxLength={120} required /></label><button className="secondary-button">Review credit limit</button></fieldset></form></div>
    </>}
    {draft && <div className="action-confirmation" role="region" aria-label="Confirm top-up"><h3>Confirm wallet top-up</h3><p><strong>{draft.name} · {draft.roll}</strong><br />Add {rupees(draft.body.amount)} · Reference: {draft.body.reference}</p><p>Confirm only after receiving the payment.</p><div><button className="primary-button" disabled={busy} onClick={() => void sendTopUp(draft)}>Confirm top-up</button><button className="secondary-button" onClick={() => setDraft(null)}>Cancel top-up</button></div></div>}
    {limitDraft && <div className="action-confirmation" role="region" aria-label="Confirm credit limit"><h3>Confirm credit limit</h3><p>{account?.name} · {account?.roll_no}<br />{rupees(limitDraft.expected_credit_limit)} → {rupees(limitDraft.credit_limit)}<br />Reason: {limitDraft.reason}</p><div><button className="primary-button" disabled={busy} onClick={() => void saveLimit()}>Confirm limit change</button><button className="secondary-button" disabled={busy} onClick={() => setLimitDraft(null)}>Cancel limit change</button></div></div>}
    <WalletHistory key={`wallet-${reload}`} path={`/admin/accounts/${studentId}/wallet-transactions`} onSessionExpired={expired} />
    <LimitHistory key={`limit-${reload}`} studentId={studentId} expired={expired} />
  </section>;
}
