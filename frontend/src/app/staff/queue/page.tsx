"use client";
import Link from "next/link";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/SessionProvider";
import { useOrderSocket } from "@/hooks/useOrderSocket";
import { useQueueActions } from "@/hooks/useQueueActions";
import { OrderTicket } from "@/components/OrderTicket";
const columns = [{ status: "received", label: "Received", hint: "Waiting for the kitchen" }, { status: "preparing", label: "Preparing", hint: "Being made now" }, { status: "ready", label: "Ready", hint: "Waiting for collection" }];
export default function Queue() {
  const { session, setSession } = useSession();
  const router = useRouter();
  const expired = useCallback(() => { setSession(null); router.replace("/sign-in"); }, [setSession, router]);
  const stream = useOrderSocket(session, expired);
  const actions = useQueueActions(session, stream.isLive, stream.applyOrder, stream.reconnect, expired);
  const [search, setSearch] = useState("");
  const live = stream.connection === "live";
  const disabled = !live || !actions.ready || !!actions.storageError;
  const visible = stream.orders.filter(order => `${order.student_name} ${order.token_number} ${String(order.token_number).padStart(2, "0")} ${order.order_date} ${order.id}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <main id="main" className="admin-students queue-page"><div className="admin-page-heading"><div><p className="eyebrow">THE KITCHEN BOARD</p><h1>Live order queue</h1><p>Oldest first in each stage. Keep the date with the token.</p></div><Link className="primary-button" href="/staff/counter">Take an order →</Link></div>
    <div className={`queue-connection ${live ? "connected" : "disconnected"}`}><p role="status"><span aria-hidden="true" />{stream.message}</p><button className="secondary-button" onClick={stream.reconnect}>{live ? "Resync queue" : "Reconnect now"}</button></div>
    {!live && <p className="queue-stale-note">Any tickets shown are from the last snapshot. Controls stay paused until the queue reconnects.</p>}
    {actions.storageError && <p className="form-error" role="alert">{actions.storageError}</p>}
    {Object.entries(actions.errors).filter(([, message]) => message).map(([id, message]) => <p className="form-error" role="alert" key={id}>Order #{id}: {message}</p>)}
    {actions.attempts.length > 0 && <section className="queue-recovery" aria-label="Saved status updates"><h2>Updates awaiting confirmation</h2><p>Retry the original transition before advancing this ticket again. Keep this tab until every update is resolved.</p>{actions.attempts.map(attempt => <div key={attempt.id}><span><strong>Token {String(attempt.token).padStart(2, "0")} · {attempt.date}</strong><small>{attempt.student} · Order #{attempt.id} · {attempt.expected_status} → {attempt.status}</small></span><button className="secondary-button" disabled={disabled || actions.busy.includes(attempt.id)} onClick={() => actions.retry(attempt)}>{actions.busy.includes(attempt.id) ? "Saving…" : `Retry update for order ${attempt.id}`}</button></div>)}</section>}
    <div className="queue-toolbar"><label className="field"><span>Find a ticket</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, token, date or order number" /></label><p>{stream.orders.length} active {stream.orders.length === 1 ? "order" : "orders"}{search && ` · ${visible.length} matching`}</p></div>
    {live && !stream.orders.length && <div className="queue-empty" role="status"><h2>The kitchen is caught up.</h2><p>New orders will appear here automatically.</p></div>}
    {live && stream.orders.length > 0 && !visible.length && <p className="history-message">No tickets match this search.</p>}
    <div className="queue-board">{columns.map(column => { const orders = visible.filter(order => order.status === column.status); return <section className={`queue-column column-${column.status}`} aria-label={column.label} key={column.status}><div className="queue-column-heading"><h2>{column.label}<span>{orders.length}</span></h2><p>{column.hint}</p></div><div className="queue-tickets">{orders.map(order => <OrderTicket key={order.id} order={order} pending={actions.attempts.some(attempt => attempt.id === order.id)} disabled={disabled || actions.busy.includes(order.id)} advance={() => actions.advance(order)} />)}{!orders.length && <p className="queue-column-empty">{live ? "No orders in this stage." : "Waiting for live sync…"}</p>}</div></section>; })}</div>
    <p className="history-footnote">All uncollected orders stay here, including previous days. Confirm collection only after handover; collected tickets leave the board. Status updates do not change charges.</p>
  </main>;
}
