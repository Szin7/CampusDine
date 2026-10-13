"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, type Order, type Session } from "@/lib/api";
export type QueueAttempt = { id: number; token: number; date: string; student: string; expected_status: string; status: string };
const next: Record<string, string> = { received: "preparing", preparing: "ready", ready: "collected" };
export function useQueueActions(session: Session | null, isLive: () => boolean, apply: (order: Order) => void, reconnect: () => void, expired: () => void) {
  const [attempts, setAttempts] = useState<QueueAttempt[]>([]);
  const saved = useRef<QueueAttempt[]>([]);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number[]>([]);
  const inFlight = useRef(new Set<number>());
  const mounted = useRef(true);
  const key = session?.role === "staff" ? `campusdine-queue-actions:${session.id}` : null;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setReady(false); setAttempts([]); saved.current = []; setStorageError("");
    if (!key) return;
    try {
      const raw = sessionStorage.getItem(key), values: QueueAttempt[] = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(values) || values.some(value => !Number.isInteger(value.id) || value.id < 1 || next[value.expected_status] !== value.status || typeof value.date !== "string" || typeof value.student !== "string") || new Set(values.map(value => value.id)).size !== values.length) throw new Error("Invalid saved action");
      saved.current = values; setAttempts(values); setReady(true);
    } catch { setStorageError("Saved queue actions could not be read. Reconcile the order states before clearing this tab’s storage."); }
  }, [key]);
  function persist(values: QueueAttempt[]) {
    sessionStorage.setItem(key!, JSON.stringify(values)); saved.current = values;
    if (mounted.current) setAttempts(values);
  }
  async function send(attempt: QueueAttempt) {
    if (!key || !session || !ready || storageError || !isLive() || inFlight.current.has(attempt.id)) return;
    const existing = saved.current.find(value => value.id === attempt.id);
    const request = existing ?? attempt;
    try { if (!existing) persist([...saved.current, request]); }
    catch { setStorageError("Browser storage is unavailable. No status change was sent. Restore storage and reload this screen."); return; }
    inFlight.current.add(request.id); setBusy([...inFlight.current]); setErrors(values => ({ ...values, [request.id]: "" }));
    try {
      const order = await api<Order>(`/staff/orders/${request.id}/status`, { method: "PATCH", body: JSON.stringify({ expected_status: request.expected_status, status: request.status }), signal: AbortSignal.timeout(30000) }, session.csrf_token);
      persist(saved.current.filter(value => value.id !== request.id));
      if (mounted.current) apply(order);
    } catch (err) {
      if (!mounted.current) return;
      if (err instanceof ApiError && [401, 403].includes(err.status)) { expired(); return; }
      if (err instanceof ApiError && [404, 409, 422].includes(err.status)) {
        try { persist(saved.current.filter(value => value.id !== request.id)); } catch { setStorageError("Could not clear the saved action. Reload after restoring browser storage."); }
        setErrors(values => ({ ...values, [request.id]: `${err.message} The queue is being refreshed.` })); reconnect();
      } else setErrors(values => ({ ...values, [request.id]: "Result unconfirmed. Retry the saved transition; it cannot skip a stage." }));
    } finally { inFlight.current.delete(request.id); if (mounted.current) setBusy([...inFlight.current]); }
  }
  function advance(order: Order) { if (next[order.status]) void send({ id: order.id, token: order.token_number, date: order.order_date, student: order.student_name, expected_status: order.status, status: next[order.status] }); }
  return { attempts, ready, storageError, errors, busy, advance, retry: (attempt: QueueAttempt) => void send(attempt) };
}
