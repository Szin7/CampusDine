"use client";
import Link from "next/link";
import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/SessionProvider";
import { StudentNavigation } from "@/components/StudentNavigation";
import { StudentOrder } from "@/components/StudentOrder";
import { useOrderSocket } from "@/hooks/useOrderSocket";
export default function Orders() {
  const { session, loading, error, refresh, setSession } = useSession();
  const router = useRouter();
  const expired = useCallback(() => { setSession(null); router.replace("/sign-in"); }, [setSession, router]);
  const stream = useOrderSocket(session?.role === "student" && !error ? session : null, expired);
  useEffect(() => {
    if (loading || error) return;
    if (!session) router.replace("/sign-in");
    else if (session.role !== "student") router.replace("/account");
  }, [session, loading, error, router]);
  if (error) return <main id="main" className="account-page"><div role="alert" className="form-error">{error}<button className="text-button" onClick={() => void refresh()}>Try again</button><Link href="/sign-in">Back to sign in</Link></div></main>;
  if (loading || session?.role !== "student") return <main id="main" className="account-page"><p role="status">Opening your orders…</p></main>;
  const live = stream.connection === "live";
  const active = stream.orders.filter(order => order.status !== "collected");
  const collected = stream.orders.filter(order => order.status === "collected").sort((a, b) => b.id - a.id).slice(0, 20);
  const ready = active.filter(order => order.status === "ready").length;
  return <main id="main" className="orders-page"><div className="student-toolbar"><StudentNavigation active="/orders" /></div>
    <div className="orders-heading"><div><p className="eyebrow">FROM THE KITCHEN TO YOU</p><h1>Your next campus break.</h1><p>Follow your order. Keep the date with your token.</p></div><Link className="primary-button" href="/menu">Browse the menu →</Link></div>
    <div className={`queue-connection ${live ? "connected" : "disconnected"}`}><p role="status"><span aria-hidden="true" />{stream.message}</p><button className="secondary-button" onClick={stream.reconnect}>{live ? "Refresh orders" : "Reconnect now"}</button></div>
    {!live && <p className="queue-stale-note">Shown statuses are last known. We’ll refresh them as soon as the connection returns.</p>}
    <p className="orders-announcement" role="status" aria-live="polite" aria-atomic="true">{live ? ready ? `${ready} ${ready === 1 ? "order is" : "orders are"} ready for collection.` : `${active.length} active ${active.length === 1 ? "order" : "orders"}.` : "Waiting for live order updates."}</p>
    <section aria-label="Active orders"><div className="orders-section-heading"><h2>On the way</h2><span>{active.length} active</span></div>
      {active.length > 0 ? <div className="student-order-grid">{active.map(order => <StudentOrder key={order.id} order={order} live={live} />)}</div> : live ? <div className="orders-empty"><h3>No active orders.</h3><p>Orders placed here or at the counter will appear automatically.</p><Link className="secondary-button" href="/menu">Find something to eat</Link></div> : <p className="history-message">Loading your latest orders…</p>}
    </section>
    <section aria-label="Recently collected" className="orders-collected"><div className="orders-section-heading"><h2>Recently collected</h2><span>{collected.length} shown</span></div><p className="history-footnote">Your 20 most recent collected orders. This is a recent view, not your full purchase history.</p>
      {collected.length > 0 ? <div className="student-order-grid">{collected.map(order => <StudentOrder key={order.id} order={order} live={live} />)}</div> : live ? <p className="history-message">No collected orders yet.</p> : <p className="history-message">Waiting for the latest collected orders…</p>}
    </section><p className="history-footnote">Preparation times vary. The kitchen updates each stage; no estimated wait time is available.</p>
  </main>;
}
