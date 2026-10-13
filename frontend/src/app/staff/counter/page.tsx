"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, readMenu, rupees, type MenuItem } from "@/lib/api";
import { useCounterBasket, type CounterStudent } from "@/lib/useCounterBasket";
import { useSession } from "@/components/SessionProvider";
import { FaceCapture } from "@/components/FaceCapture";
import { Basket } from "@/components/Basket";
import { MenuCard } from "@/components/MenuCard";
export default function Counter() {
  const { session, setSession } = useSession();
  const router = useRouter();
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [menuError, setMenuError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const [roll, setRoll] = useState("");
  const [message, setMessage] = useState("");
  const [identifying, setIdentifying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [studentError, setStudentError] = useState("");
  const [changeStudent, setChangeStudent] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const identifyingRef = useRef(false);
  const lookupAbort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const expired = useCallback(() => { setSession(null); router.replace("/sign-in"); }, [setSession, router]);
  const basket = useCounterBasket(session, menu, () => { setReload(value => value + 1); setStudentError("Refresh this student's details before confirming another checkout."); }, expired);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; lookupAbort.current?.abort(); }; }, []);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setMenuError(""); setMenu([]);
    readMenu(abort.signal).then(items => { if (!abort.signal.aborted) setMenu(items); }).catch(err => {
      if (abort.signal.aborted) return;
      if (err instanceof ApiError && [401, 403].includes(err.status)) expired(); else setMenuError((err as Error).message);
    }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [reload, expired]);
  async function identify(photo?: File) {
    if (!session || identifyingRef.current || basket.student || !basket.ready || basket.storageError) return;
    identifyingRef.current = true; setIdentifying(true); setMessage("");
    const abort = new AbortController(); lookupAbort.current = abort;
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(30000)]);
    try {
      let student: CounterStudent | null;
      if (photo) {
        const body = new FormData(); body.set("face_photo", photo);
        const result = await api<{ status: string; student: CounterStudent | null; message: string }>("/counter/identify", { method: "POST", body, signal }, session.csrf_token);
        student = result.status === "matched" ? result.student : null;
        if (!student) { if (!abort.signal.aborted) setMessage(result.message); return; }
      } else student = await api<CounterStudent>(`/counter/students?roll_no=${encodeURIComponent(roll.trim())}`, { signal });
      if (!abort.signal.aborted && mounted.current) { basket.identify(student); setStudentError(""); setRoll(""); setQuery(""); setCategory(""); }
    } catch (err) {
      if (abort.signal.aborted || !mounted.current) return;
      if (err instanceof ApiError && [401, 403].includes(err.status)) expired(); else setMessage((err as Error).message);
    } finally { identifyingRef.current = false; if (mounted.current) setIdentifying(false); }
  }
  async function refreshStudent() {
    if (!basket.student || refreshing || basket.pending || basket.receipt) return;
    const studentId = basket.student.id;
    setRefreshing(true); setStudentError("");
    try {
      const student = await api<CounterStudent>(`/counter/students?roll_no=${encodeURIComponent(basket.student.roll_no)}`, { signal: AbortSignal.timeout(30000) });
      if (mounted.current && student.id === studentId) basket.updateStudent(student);
    } catch (err) {
      if (!mounted.current) return;
      if (err instanceof ApiError && [401, 403].includes(err.status)) expired(); else setStudentError((err as Error).message);
    } finally { if (mounted.current) setRefreshing(false); }
  }
  function lookup(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void identify(); }
  function clear() { basket.newOrder(); setChangeStudent(false); setMessage(""); setStudentError(""); setQuery(""); setCategory(""); }
  const categories = [...new Set(menu.map(item => item.category))].sort();
  const visible = menu.filter(item => (!category || item.category === category) && `${item.name} ${item.category}`.toLowerCase().includes(query.trim().toLowerCase()));
  const availableStudent = basket.confirmed && !studentError && !refreshing ? basket.student : null;
  return <main id="main" className="admin-students counter-page"><div className="admin-page-heading"><div><p className="eyebrow">IDENTIFY · CONFIRM · ORDER</p><h1>Counter orders</h1><p>One student, one basket, one token.</p></div><span className="counter-staff-name">{session?.name}</span></div>
    {!basket.ready ? <p role="status">Opening counter…</p> : !basket.student && !basket.storageError ? <div className="counter-identification"><FaceCapture busy={identifying} identify={photo => void identify(photo)} /><section className="counter-lookup"><p className="eyebrow">ROLL-NUMBER FALLBACK</p><h2>Find a student</h2><p>Use the college roll number when a face cannot be identified reliably.</p><form onSubmit={lookup}><fieldset className="form-fields" disabled={identifying}><label className="field"><span>Student roll number</span><input value={roll} onChange={event => setRoll(event.target.value)} required maxLength={40} autoCapitalize="none" placeholder="NCE-081-001" /></label><button className="primary-button">{identifying ? "Checking student…" : "Look up student"}</button></fieldset></form><p className="history-footnote">Identification never charges the account. Only active, approved students can place new orders.</p>{message && <p role="alert" className="form-error">{message}</p>}</section></div> : null}
    {basket.student && <section className="counter-student" aria-label="Identified student"><div className="history-heading"><div><p className="eyebrow">{basket.student.roll_no} · {basket.student.department} · Semester {basket.student.semester}</p><h2>{basket.student.name}</h2></div>{!basket.pending && !basket.receipt && <button className="secondary-button" disabled={basket.busy || refreshing} onClick={() => setChangeStudent(true)}>Change student</button>}</div>
      {!basket.receipt && !basket.pending && <><dl className="review-balances"><div><dt>Wallet balance</dt><dd>{rupees(basket.student.wallet_balance)}</dd></div><div><dt>Available credit</dt><dd>{rupees(basket.student.credit_limit - basket.student.credit_balance)}</dd></div><div><dt>Outstanding dues</dt><dd>{rupees(basket.student.credit_balance)}</dd></div></dl><div className="counter-confirm"><button className="primary-button" disabled={basket.confirmed || !!studentError || refreshing} onClick={basket.confirmStudent}>{basket.confirmed ? "Student confirmed" : "Confirm student details"}</button><button className="secondary-button" disabled={refreshing || basket.busy} onClick={() => void refreshStudent()}>{refreshing ? "Refreshing…" : "Refresh student"}</button><p>Check the name and roll number with the student before ordering.</p></div></>}
      {studentError && !basket.receipt && <p role="alert" className="form-error">{studentError}</p>}
      {basket.pending && <p className="payment-note">A checkout for this student is unresolved. Retry the saved order before serving the next student.</p>}
      {changeStudent && <div className="action-confirmation"><p>Discard this basket and identify another student?</p><div><button className="primary-button" disabled={basket.busy || !!basket.pending} onClick={clear}>Discard and change student</button><button className="secondary-button" onClick={() => setChangeStudent(false)}>Keep this student</button></div></div>}
    </section>}
    {(basket.student || basket.storageError) && <div className="ordering-layout"><section className="menu-content" aria-label="Counter menu"><div className="menu-controls-heading"><h2>Counter menu</h2><button className="secondary-button" disabled={loading || !!basket.pending || basket.busy} onClick={() => setReload(value => value + 1)}>Reload menu</button></div>
      {loading ? <p role="status">Loading menu…</p> : menuError ? <p role="alert" className="form-error">{menuError}</p> : <><label className="field"><span>Find a dish</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Dish or category" /></label><div className="category-filters counter-categories" aria-label="Counter categories"><button aria-pressed={!category} onClick={() => setCategory("")}>Everything</button>{categories.map(name => <button key={name} aria-pressed={category === name} onClick={() => setCategory(name)}>{name}</button>)}</div><div className="menu-grid">{visible.map(item => <MenuCard key={item.id} item={item} disabled={basket.locked || !availableStudent || changeStudent || (basket.lines.find(line => line.item.id === item.id)?.quantity ?? 0) >= 50 || (!basket.lines.some(line => line.item.id === item.id) && basket.lines.length >= 50)} onAdd={() => basket.change(item, 1)} />)}</div>{!visible.length && <p className="history-message">No dishes match this view.</p>}</>}
    </section><Basket counter basket={{ ...basket, checkout: async () => { if (!changeStudent && (basket.pending || availableStudent)) await basket.checkout(); }, newOrder: clear }} student={changeStudent ? null : availableStudent} /></div>}
  </main>;
}
