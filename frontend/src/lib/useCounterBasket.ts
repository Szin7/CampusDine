"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, type CheckoutBody, type MenuItem, type Order, type Session } from "./api";
import type { BasketLine } from "./useBasket";
export type CounterStudent = { id: number; roll_no: string; name: string; department: string; semester: number; wallet_balance: number; credit_balance: number; credit_limit: number };
type CounterRequest = CheckoutBody & { student_id: number };
type CounterState = { student: CounterStudent | null; lines: BasketLine[]; pending: CounterRequest | null; receipt: Order | null };
const empty = (): CounterState => ({ student: null, lines: [], pending: null, receipt: null });
export function useCounterBasket(session: Session | null, menu: MenuItem[], review: () => void, expired: () => void) {
  const [state, setState] = useState<CounterState>(empty);
  const [ready, setReady] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const key = session?.role === "staff" ? `campusdine-counter:${session.id}` : null;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setReady(false); setState(empty()); setConfirmed(false); setError(""); setStorageError(false);
    if (!key) return;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const saved = JSON.parse(raw) as CounterState;
        if (!saved.student || !Number.isSafeInteger(saved.student.id) || typeof saved.student.roll_no !== "string" || !Array.isArray(saved.lines) || saved.lines.length > 50 || saved.lines.some(line => !line.item || !Number.isInteger(line.item.id) || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 50) || (!saved.pending && !saved.receipt)) throw new Error("Invalid saved order");
        if (saved.pending && (saved.pending.student_id !== saved.student.id || typeof saved.pending.checkout_key !== "string" || !Array.isArray(saved.pending.items) || saved.pending.items.length < 1 || saved.pending.items.length > 50 || !Number.isSafeInteger(saved.pending.expected_total) || saved.pending.expected_total <= 0)) throw new Error("Invalid pending request");
        if (saved.receipt && saved.receipt.student_id !== saved.student.id) throw new Error("Invalid receipt");
        setState(saved);
      }
    } catch { setStorageError(true); setError("The saved counter order could not be read. Keep this tab open and reconcile recent orders before clearing browser data."); }
    setReady(true);
  }, [key]);
  const lines = state.pending ? state.lines : state.lines.map(line => ({ ...line, item: menu.find(item => item.id === line.item.id) ?? { ...line.item, is_available: false } }));
  const total = state.pending?.expected_total ?? lines.reduce((sum, line) => sum + line.item.price * line.quantity, 0);
  const locked = !ready || busy || !!state.pending || !!state.receipt || storageError;
  function identify(student: CounterStudent) {
    if (locked || state.student) return;
    setState({ ...empty(), student }); setConfirmed(false); setError("");
  }
  function updateStudent(student: CounterStudent) {
    setState(current => current.student?.id === student.id && !current.pending && !current.receipt ? { ...current, student } : current);
    setConfirmed(false);
  }
  function change(item: MenuItem, delta: number) {
    if (locked || !confirmed || !state.student) return;
    const old = lines.find(line => line.item.id === item.id), quantity = (old?.quantity ?? 0) + delta;
    if (quantity > 50 || (!old && lines.length >= 50) || (delta > 0 && !item.is_available)) return;
    const next = lines.filter(line => line.item.id !== item.id);
    if (quantity > 0) next.push({ item, quantity });
    setState(current => ({ ...current, lines: next.sort((a, b) => a.item.id - b.item.id) })); setError("");
  }
  async function checkout() {
    if (!key || !session || !ready || storageError || inFlight.current || state.receipt || !state.student) return;
    if (!state.pending && (!confirmed || !lines.length || lines.some(line => !line.item.is_available || line.item.is_archived))) return;
    const request = state.pending ?? { checkout_key: crypto.randomUUID(), student_id: state.student.id, expected_total: total, items: lines.map(line => ({ menu_item_id: line.item.id, quantity: line.quantity })) };
    const attempt = { ...state, lines, pending: request, receipt: null };
    try { sessionStorage.setItem(key, JSON.stringify(attempt)); }
    catch { setStorageError(true); setError("Browser storage is unavailable. No order was sent. Enable storage before ordering."); return; }
    inFlight.current = true; setBusy(true); setError(""); setState(attempt);
    try {
      const receipt = await api<Order>("/counter/orders", { method: "POST", body: JSON.stringify(request), signal: AbortSignal.timeout(30000) }, session.csrf_token);
      const result = { ...attempt, lines: [], pending: null, receipt };
      try { sessionStorage.setItem(key, JSON.stringify(result)); } catch { /* Saved pending request still safely recovers this receipt. */ }
      if (mounted.current) setState(result);
    } catch (err) {
      if (!mounted.current) return;
      if (err instanceof ApiError && [409, 422].includes(err.status) && !err.message.includes("checkout key")) {
        try { sessionStorage.removeItem(key); setState(current => ({ ...current, pending: null })); }
        catch { setStorageError(true); }
        setConfirmed(false); setError(`${err.message} Refresh and confirm the student's details before trying again.`); review();
      } else {
        if (err instanceof ApiError && [401, 403].includes(err.status)) expired();
        setError("The result is unconfirmed. Sign in with the same staff account if needed, then retry this saved order. Do not start a new checkout for this payment.");
      }
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  function newOrder() {
    if (busy || state.pending || storageError || !key) return;
    try { sessionStorage.removeItem(key); setState(empty()); setConfirmed(false); setError(""); }
    catch { setStorageError(true); setError("Could not clear the previous order. Keep this tab open and retry after restoring browser storage."); }
  }
  return { student: state.student, confirmed, confirmStudent: () => setConfirmed(true), identify, updateStudent, lines, total, pending: state.pending, receipt: state.receipt, ready, busy, error, storageError, locked: locked || !confirmed, change, checkout, newOrder };
}
