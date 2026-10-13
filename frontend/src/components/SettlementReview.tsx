"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { rupees } from "@/lib/api";
import type { PendingSettlement } from "@/lib/billing";
export function SettlementReview({ request, pending, busy, error, close, submit }: {
  request: PendingSettlement; pending: boolean; busy: boolean; error: string;
  close: () => void; submit: (request: PendingSettlement) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reference, setReference] = useState(request.body.reference);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !reference.trim() || !confirmed) return;
    submit({ ...request, body: { ...request.body, reference: reference.trim() } });
  }
  return <dialog ref={dialog} className="student-dialog settlement-dialog" aria-labelledby="settlement-title" onCancel={event => { event.preventDefault(); if (!busy && !pending) close(); }}>
    <div className="dialog-heading"><div><p className="eyebrow">ACCOUNTS TRANSFER</p><h2 id="settlement-title">{pending ? "Recover settlement" : "Review settlement"}</h2></div>{!pending && <button className="secondary-button" disabled={busy} onClick={close}>Close</button>}</div>
    <div className="settlement-summary"><strong>{request.name}</strong><span>{request.roll} · {request.month}</span><p className="settlement-amount">{rupees(request.body.expected_amount)}</p><p>{request.body.ledger_ids.length} credit {request.body.ledger_ids.length === 1 ? "entry" : "entries"} selected</p></div>
    <details><summary>Review ledger entry IDs</summary><p className="ledger-ids">{request.body.ledger_ids.join(", ")}</p></details>
    <p className="history-footnote">Only these entries will be settled. Newer debt remains outstanding. The wallet balance stays unchanged.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {pending ? <><p className="history-footnote">Reference: <strong>{request.body.reference}</strong></p><p>This settlement may already be recorded. Retry the saved request to recover the original receipt. Keep this tab until it is resolved.</p><button className="primary-button" disabled={busy} onClick={() => submit(request)}>{busy ? "Checking receipt…" : "Retry saved settlement"}</button></> : <form onSubmit={confirm}><fieldset className="form-fields" disabled={busy}><label className="field"><span>Accounts transfer reference</span><input value={reference} onChange={event => setReference(event.target.value)} maxLength={120} required autoFocus /></label><label className="menu-checkbox"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required /><span>I have verified the accounts transfer for this amount.</span></label><button className="primary-button" disabled={!confirmed || !reference.trim()}>Confirm settlement</button><button className="secondary-button" type="button" onClick={close}>Cancel</button></fieldset></form>}
  </dialog>;
}
