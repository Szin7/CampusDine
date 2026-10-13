"use client";
import { useEffect, useRef, useState } from "react";
import { api, ApiError, type CheckoutBody, type MenuItem, type Order, type Session } from "./api";
export type BasketLine = { item: MenuItem; quantity: number };
type SavedBasket = { lines: BasketLine[]; pending: CheckoutBody | null; receipt: Order | null };
const empty = (): SavedBasket => ({ lines: [], pending: null, receipt: null });
export function useBasket(session: Session | null, menu: MenuItem[], onConfirmed: () => void, onReview: () => void, onSessionExpired: () => void) {
  const [basket, setBasket] = useState<SavedBasket>(empty);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState(false);
  const inFlight = useRef(false);
  const storageKey = session?.role === "student" ? `campusdine-basket:${session.id}` : null;
  useEffect(() => {
    setReady(false); setBasket(empty()); setError(""); setStorageError(false);
    if (!storageKey) return;
    try {
      const raw = sessionStorage.getItem(storageKey);
      const saved: SavedBasket = raw ? JSON.parse(raw) : empty();
      if (!Array.isArray(saved.lines) || saved.lines.length > 50 || saved.lines.some(line => !line.item || !Number.isInteger(line.item.id) || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 50)
          || (saved.pending && (typeof saved.pending.checkout_key !== "string" || !Array.isArray(saved.pending.items)))) throw new Error("Invalid saved basket");
      setBasket(saved);
    } catch { setStorageError(true); setError("Your saved basket could not be opened. Keep this tab open and contact the counter before placing another order."); }
    setReady(true);
  }, [storageKey]);
  const pending = basket.pending;
  const lines = pending ? basket.lines : basket.lines.map(line => ({ ...line, item: menu.find(item => item.id === line.item.id) ?? { ...line.item, is_available: false } }));
  const total = pending?.expected_total ?? lines.reduce((sum, line) => sum + line.item.price * line.quantity, 0);
  function save(next: SavedBasket) {
    if (!storageKey) throw new Error("Sign in before ordering.");
    // Save the exact request before POST. A reload after a lost response must reuse its key and prices.
    sessionStorage.setItem(storageKey, JSON.stringify(next));
    setBasket(next);
  }
  function change(item: MenuItem, difference: number) {
    if (!ready || busy || pending || basket.receipt || storageError) return;
    const existing = lines.find(line => line.item.id === item.id);
    const quantity = (existing?.quantity ?? 0) + difference;
    if (quantity > 50 || (!existing && lines.length >= 50) || (difference > 0 && !item.is_available)) return;
    const next = lines.filter(line => line.item.id !== item.id);
    if (quantity > 0) next.push({ item, quantity });
    try { save({ lines: next.sort((a, b) => a.item.id - b.item.id), pending: null, receipt: null }); setError(""); }
    catch { setStorageError(true); setError("Browser storage is unavailable. Enable it before placing an order so a lost response can be retried safely."); }
  }
  async function checkout() {
    if (!session || !ready || inFlight.current || storageError || basket.receipt) return;
    if (!pending && (!lines.length || lines.some(line => !line.item.is_available || line.item.is_archived))) return;
    const request = pending ?? { checkout_key: crypto.randomUUID(), expected_total: total, items: lines.map(line => ({ menu_item_id: line.item.id, quantity: line.quantity })) };
    inFlight.current = true; setBusy(true); setError("");
    try { save({ lines, pending: request, receipt: null }); }
    catch { setStorageError(true); setError("Browser storage is unavailable. No order was sent."); setBusy(false); inFlight.current = false; return; }
    try {
      const order = await api<Order>("/orders", { method: "POST", body: JSON.stringify(request), signal: AbortSignal.timeout(30000) }, session.csrf_token);
      const confirmed = { lines: [], pending: null, receipt: order };
      setBasket(confirmed);
      try { save(confirmed); } catch { /* Keeping the old pending request is safe: its next retry returns this order. */ }
      onConfirmed();
    } catch (err) {
      if (err instanceof ApiError && [409, 422].includes(err.status) && !err.message.includes("checkout key")) {
        try { save({ lines, pending: null, receipt: null }); }
        catch { setStorageError(true); }
        setError(`${err.message} Review the basket before trying again.`);
        onReview();
      } else {
        if (err instanceof ApiError && [401, 403].includes(err.status)) onSessionExpired();
        setError(err instanceof ApiError && [401, 403].includes(err.status)
          ? "Your session needs attention. Sign in again with this student account, then retry this order."
          : "We couldn’t confirm the result. Your basket is locked. Retry this same order to recover its token without a second charge.");
      }
    } finally { setBusy(false); inFlight.current = false; }
  }
  function newOrder() {
    if (!basket.receipt || busy) return;
    try { save(empty()); setError(""); }
    catch { setStorageError(true); setError("Could not clear the saved receipt. Please keep this tab open and try again."); }
  }
  return { lines, total, pending, receipt: basket.receipt, ready, busy, error, storageError, change, checkout, newOrder, locked: !ready || busy || !!pending || !!basket.receipt || storageError };
}
