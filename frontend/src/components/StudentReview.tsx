"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError, rupees, type Student } from "@/lib/api";
import { useSession } from "./SessionProvider";
type Action = "approve" | "reject" | "suspend" | "activate";
const actionNames: Record<Action, string> = { approve: "Approve enrollment", reject: "Reject enrollment", suspend: "Suspend account", activate: "Reactivate account" };
export function StudentReview({ studentId, close, changed, expired }: { studentId: number; close: () => void; changed: () => void; expired: () => void }) {
  const { session } = useSession();
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [student, setStudent] = useState<Student | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    setStudent(null);
    api<Student>(`/admin/students/${studentId}`, { signal: abort.signal }).then(value => { if (!abort.signal.aborted) setStudent(value); }).catch(err => {
      if (abort.signal.aborted) return;
      if (err instanceof ApiError && [401, 403].includes(err.status)) expired(); else setError((err as Error).message);
    });
    return () => abort.abort();
  }, [studentId, reload, expired]);
  async function mutate(path: string, body: object, method: "POST" | "PATCH", message: string, refreshOnFailure = false) {
    if (!session || submitting.current) return;
    submitting.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const updated = await api<Student>(path, { method, body: JSON.stringify(body) }, session.csrf_token);
      setStudent(updated); setAction(null); setNotice(message); changed();
    } catch (err) {
      if (err instanceof ApiError && [401, 403].includes(err.status)) expired();
      else {
        setError((err as Error).message);
        if (refreshOnFailure) { setAction(null); setReload(value => value + 1); changed(); }
      }
    } finally { submitting.current = false; setBusy(false); }
  }
  function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!student) return;
    const data = new FormData(event.currentTarget);
    const values = { name: String(data.get("name")).trim(), email: String(data.get("email")).trim().toLowerCase(), department: String(data.get("department")).trim(), semester: Number(data.get("semester")) };
    const patch = Object.fromEntries(Object.entries(values).filter(([field, value]) => value !== student[field as keyof typeof values]));
    if (!Object.keys(patch).length) { setNotice("No changes to save."); return; }
    void mutate(`/admin/students/${studentId}`, patch, "PATCH", "Student details saved.");
  }
  function confirmAction() {
    if (!student || !action) return;
    if (action === "approve" || action === "reject") void mutate(`/admin/students/${studentId}/approval`, { decision: action }, "POST", action === "approve" ? "Enrollment approved." : "Enrollment rejected.", true);
    else void mutate(`/admin/students/${studentId}`, { is_active: action === "activate" }, "PATCH", action === "activate" ? "Account reactivated. Enrollment approval is still required to sign in." : "Account suspended. Existing student sessions have been signed out.", true);
  }
  return <dialog className="student-dialog" ref={dialog} aria-labelledby="student-review-title" onCancel={event => { event.preventDefault(); if (!busy) close(); }}><div className="dialog-heading"><div><p className="eyebrow">STUDENT RECORD</p><h2 id="student-review-title">{student?.name ?? "Student details"}</h2>{student && <p>{student.roll_no}</p>}</div><button className="secondary-button" disabled={busy} onClick={close}>Close</button></div>
    {error && <div className="form-error" role="alert">{error}{!student && <button className="text-button" onClick={() => { setError(""); setReload(value => value + 1); }}>Reload student details</button>}</div>}
    {notice && <p className="admin-success" role="status">{notice}</p>}
    {!student && !error && <p role="status">Loading student record…</p>}
    {student && <><div className="student-state"><span className={`enrollment-status ${student.approval_status}`}>{student.approval_status === "pending" ? "Pending review" : student.approval_status === "approved" ? "Approved" : "Rejected"}</span><span>{student.is_active ? "Account enabled" : "Account suspended"}</span></div>
      {student.approval_status === "pending" && <section className="enrollment-decision"><h3>Enrollment review</h3><p>Check these details against college records before approving.</p><div><button className="primary-button" disabled={busy || !!action} onClick={() => { setAction("approve"); setNotice(""); }}>Approve enrollment</button><button className="secondary-button" disabled={busy || !!action} onClick={() => { setAction("reject"); setNotice(""); }}>Reject enrollment</button></div></section>}
      {action && <section className="action-confirmation" aria-label="Confirm student action"><h3>{actionNames[action]}?</h3><p><strong>{student.name} · {student.roll_no}</strong></p><p>{action === "approve" ? "Approval allows this student to sign in when their account is enabled." : action === "reject" ? "The student will not be able to sign in. This enrollment decision cannot be changed here." : action === "suspend" ? "This signs the student out of existing sessions and blocks new sign-ins. Their balances and order history stay on record." : "This restores account access if the enrollment is approved. Old sessions stay signed out."}</p><div><button className="primary-button" disabled={busy} onClick={confirmAction}>{busy ? "Saving…" : "Confirm"}</button><button className="secondary-button" disabled={busy} onClick={() => setAction(null)}>Cancel</button></div></section>}
      <form onSubmit={saveDetails} key={`${student.id}:${student.name}:${student.email}:${student.department}:${student.semester}`}><fieldset className="form-fields" disabled={busy || !!action}><legend className="detail-legend">Student details</legend><label className="field"><span>Full name</span><input name="name" required maxLength={120} defaultValue={student.name} /></label><div className="grid gap-5 sm:grid-cols-[1fr_120px]"><label className="field"><span>Department</span><input name="department" required maxLength={100} defaultValue={student.department} /></label><div className="field"><label htmlFor="review-semester">Semester</label><select id="review-semester" name="semester" defaultValue={student.semester}>{[1,2,3,4,5,6,7,8].map(value => <option key={value} value={value}>{value}</option>)}</select></div></div><label className="field"><span>Email</span><input name="email" type="email" required maxLength={254} defaultValue={student.email} /></label><button type="submit" className="secondary-button">Save details</button></fieldset></form>
      <dl className="review-balances"><div><dt>Wallet balance</dt><dd>{rupees(student.wallet_balance)}</dd></div><div><dt>Outstanding credit</dt><dd>{rupees(student.credit_balance)}</dd></div><div><dt>Credit limit</dt><dd>{rupees(student.credit_limit)}</dd></div></dl>
      <section className="student-access"><h3>Account access</h3><p>Enabling an account does not approve its enrollment.</p><button className="secondary-button" disabled={busy || !!action} onClick={() => { setAction(student.is_active ? "suspend" : "activate"); setNotice(""); }}>{student.is_active ? "Suspend account" : "Reactivate account"}</button></section>
    </>}
  </dialog>;
}
