import { nepalTime, rupees, type Order } from "@/lib/api";
const stages = ["received", "preparing", "ready", "collected"];
const labels = ["Received", "Preparing", "Ready", "Collected"];
const descriptions = ["Your order is with the kitchen.", "The kitchen is preparing your food.", "Your food is ready. Show this token at the canteen counter.", "This order has been collected. Thank you!"];
export function StudentOrder({ order, live }: { order: Order; live: boolean }) {
  const stage = stages.indexOf(order.status);
  return <article className={`student-order student-order-${order.status}`} aria-label={`Order ${order.id}, token ${order.token_number}, ${order.order_date}`}>
    <div className="student-order-top"><div className="student-order-token"><span>YOUR TOKEN</span><strong>{String(order.token_number).padStart(2, "0")}</strong></div><div className="student-order-identity"><time>{order.order_date}</time><span>Order #{order.id}</span><span className={`order-state ${order.status}`}>{labels[stage]}{!live && " · last known"}</span></div></div>
    <ol className="order-progress" aria-label="Order progress">{stages.map((status, index) => <li key={status} className={index <= stage ? "reached" : ""} aria-current={index === stage ? "step" : undefined}><span aria-hidden="true">{index < stage ? "✓" : index + 1}</span><strong>{labels[index]}</strong><span className="sr-only">{index < stage ? " complete" : index === stage ? " current stage" : " upcoming"}</span></li>)}</ol>
    <div className="student-order-message"><h3>{!live ? "Waiting for a live update" : stage === 2 ? "Ready for collection" : labels[stage]}</h3><p>{live ? descriptions[stage] : "This status may have changed. Reconnect for the latest update, or check with the canteen counter."}</p></div>
    <details className="student-order-details"><summary>Order details · {rupees(order.total_amount)}</summary><ul>{order.items.map(item => <li key={item.menu_item_id}><span>{item.quantity} × {item.item_name}</span><strong>{rupees(item.quantity * item.unit_price)}</strong></li>)}</ul><div><span>Total</span><strong>{rupees(order.total_amount)}</strong></div><p>{order.payment_type === "wallet" ? "Paid from your wallet." : "Charged to credit when ordered. See Wallet & credit for current dues."}</p><p>Placed <time dateTime={order.created_at}>{nepalTime(order.created_at)}</time> (Nepal time).</p></details>
  </article>;
}
