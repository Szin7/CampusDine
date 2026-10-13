"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type Order, type Session } from "@/lib/api";
type Connection = "connecting" | "live" | "reconnecting";
const statuses = ["received", "preparing", "ready", "collected"];
function isOrder(value: unknown): value is Order {
  if (!value || typeof value !== "object") return false;
  const order = value as Order;
  return Number.isInteger(order.id) && order.id > 0 && Number.isInteger(order.revision) && order.revision > 0 && statuses.includes(order.status) && typeof order.student_name === "string" && typeof order.order_date === "string" && typeof order.created_at === "string" && Number.isInteger(order.token_number) && Array.isArray(order.items) && order.items.every(item => typeof item.item_name === "string" && Number.isInteger(item.quantity));
}
export function useOrderSocket(session: Session | null, expired: () => void) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [message, setMessage] = useState("Connecting to the order stream…");
  const [generation, setGeneration] = useState(0);
  const merge = useRef<(order: Order) => void>(() => {});
  const live = useRef(false);
  const applyOrder = useCallback((order: Order) => merge.current(order), []);
  const reconnect = useCallback(() => { live.current = false; setConnection("reconnecting"); setGeneration(value => value + 1); }, []);
  useEffect(() => {
    if (!session || !["staff", "student"].includes(session.role)) return;
    let disposed = false, socket: WebSocket | null = null, retry: ReturnType<typeof setTimeout> | undefined, startup: ReturnType<typeof setTimeout> | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined, failures = 0, lastMessage = Date.now(), snapshotReceived = false, watermark = 0;
    let records = new Map<number, Order>(), revisions = new Map<number, number>();
    const interrupted = session.role === "staff" ? "Connection interrupted. Reconnecting; status changes are paused." : "Connection interrupted. Reconnecting to your orders…";
    const snapshotMessage = session.role === "staff" ? "Loading a fresh queue snapshot…" : "Loading your latest orders…";
    const abort = new AbortController();
    live.current = false; setConnection("connecting"); setMessage(snapshotMessage);
    function publish() { setOrders([...records.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id)); }
    merge.current = order => {
      if (disposed || !snapshotReceived || !isOrder(order) || order.revision <= Math.max(watermark, revisions.get(order.id) ?? 0)) return;
      revisions.set(order.id, order.revision);
      if (session!.role === "staff" && order.status === "collected") records.delete(order.id); else records.set(order.id, order);
      publish();
    };
    function connect() {
      if (disposed) return;
      snapshotReceived = false; live.current = false;
      setConnection(failures ? "reconnecting" : "connecting");
      setMessage(failures ? interrupted : snapshotMessage);
      const url = new URL("/api/ws/orders", window.location.href); url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const ws = new WebSocket(url); socket = ws;
      startup = setTimeout(() => { if (!snapshotReceived) ws.close(); }, 12000);
      ws.onmessage = event => {
        if (disposed || ws !== socket) return;
        lastMessage = Date.now();
        try {
          const data = JSON.parse(event.data);
          if (data.type === "pong") return;
          if (data.type === "snapshot") {
            if (snapshotReceived || data.role !== session!.role || !Number.isInteger(data.watermark) || data.watermark < 0 || !Array.isArray(data.orders) || !data.orders.every(isOrder)) throw new Error("Invalid snapshot");
            watermark = data.watermark; records = new Map(); revisions = new Map();
            for (const order of data.orders as Order[]) { revisions.set(order.id, order.revision); if (session!.role !== "staff" || order.status !== "collected") records.set(order.id, order); }
            snapshotReceived = true; live.current = true; failures = 0; clearTimeout(startup);
            setConnection("live"); setMessage(session!.role === "staff" ? "Live · all active orders synced" : "Live · your orders are synced"); publish();
          } else if (data.type === "order.updated" && snapshotReceived && isOrder(data.order)) merge.current(data.order);
          else throw new Error("Invalid order event");
        } catch { live.current = false; snapshotReceived = false; setConnection("reconnecting"); setMessage("Resyncing the order stream…"); ws.close(); }
      };
      ws.onopen = () => {
        lastMessage = Date.now();
        heartbeat = setInterval(() => { if (Date.now() - lastMessage > 45000) ws.close(); else if (ws.readyState === WebSocket.OPEN) ws.send("ping"); }, 20000);
      };
      ws.onclose = async event => {
        clearTimeout(startup); clearInterval(heartbeat);
        if (disposed || ws !== socket) return;
        snapshotReceived = false; live.current = false; setConnection("reconnecting"); setMessage(interrupted);
        if (event.code === 4401) { setOrders([]); expired(); return; }
        // Browsers conceal rejected handshake codes. Verify the cookie before retrying.
        try {
          const current = await api<Session>("/auth/me", { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(10000)]) });
          if (disposed) return;
          if (current.id !== session!.id || current.role !== session!.role) { setOrders([]); expired(); return; }
        } catch (err) {
          if (disposed) return;
          if (err instanceof ApiError && [401, 403].includes(err.status)) { setOrders([]); expired(); return; }
        }
        if (disposed) return;
        failures++;
        if (event.code === 4429) setMessage("Too many open order screens. Close an unused tab, then reconnect.");
        retry = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(failures - 1, 5)) + Math.floor(Math.random() * 300));
      };
    }
    connect();
    const online = () => { if (!live.current) reconnect(); };
    const visible = () => { if (document.visibilityState === "visible" && Date.now() - lastMessage > 45000) reconnect(); };
    window.addEventListener("online", online); document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true; abort.abort(); live.current = false; merge.current = () => {}; clearTimeout(retry); clearTimeout(startup); clearInterval(heartbeat);
      if (socket) { socket.onclose = null; socket.onmessage = null; socket.onopen = null; socket.close(); }
      window.removeEventListener("online", online); document.removeEventListener("visibilitychange", visible);
    };
  }, [session?.id, session?.role, generation, expired, reconnect]);
  return { orders, connection, message, applyOrder, reconnect, isLive: () => live.current };
}
