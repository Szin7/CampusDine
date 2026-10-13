"use client";
import { useState } from "react";
import { nepalTime, rupees, type Order } from "@/lib/api";
export function OrderTicket({ order, disabled, pending, advance }: { order: Order; disabled: boolean; pending: boolean; advance: () => void }) {
  const [collect, setCollect] = useState(false);
  return <article className={`order-ticket ticket-${order.status}`} aria-label={`Order ${order.id}, token ${order.token_number}, ${order.order_date}`}>
    <div className="ticket-heading"><div><span className="ticket-token-label">TOKEN</span><strong className="ticket-token">{String(order.token_number).padStart(2, "0")}</strong></div><div><time>{order.order_date}</time><small>Order #{order.id}</small></div></div>
    <h3>{order.student_name}</h3><ul className="ticket-items">{order.items.map(item => <li key={item.menu_item_id}><strong>{item.quantity}×</strong><span>{item.item_name}</span></li>)}</ul>
    <div className="ticket-meta"><span>{rupees(order.total_amount)} · {order.payment_type === "wallet" ? "Wallet" : "Credit"}</span><time dateTime={order.created_at}>Placed {nepalTime(order.created_at)}</time></div>
    {pending ? <p className="payment-note">Update awaiting confirmation. Use the saved action above.</p> : collect ? <div className="ticket-collection"><p>Handed this order to <strong>{order.student_name}</strong>?</p><button className="primary-button" disabled={disabled} onClick={advance}>Confirm collection</button><button className="text-button" disabled={disabled} onClick={() => setCollect(false)}>Keep ready</button></div> : <button className={order.status === "ready" ? "primary-button" : "secondary-button"} disabled={disabled} onClick={() => order.status === "ready" ? setCollect(true) : advance()}>{order.status === "received" ? "Start preparing" : order.status === "preparing" ? "Mark ready" : "Mark collected"}</button>}
  </article>;
}
