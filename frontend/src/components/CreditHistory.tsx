"use client";
import { useState } from "react";
import { nepalTime, rupees, type CreditEntry } from "@/lib/api";
import { useHistoryPage } from "@/lib/useHistoryPage";
import { HistoryPagination } from "./HistoryPagination";
type CreditFilter = "all" | "outstanding" | "settled";
export function CreditHistory({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [filter, setFilter] = useState<CreditFilter>("all");
  const [page, setPage] = useState(0);
  const path = `/wallet/credit${filter === "all" ? "" : `?status=${filter}`}`;
  const history = useHistoryPage<CreditEntry>(path, page, onSessionExpired);
  function changeFilter(value: CreditFilter) { setFilter(value); setPage(0); }
  return <section className="account-history" aria-labelledby="credit-history-title"><div className="history-heading"><div><p className="eyebrow">YOUR CREDIT LEDGER</p><h2 id="credit-history-title">Credit purchases</h2></div><div className="category-filters credit-filters" aria-label="Credit status">{(["all", "outstanding", "settled"] as const).map(status => <button key={status} aria-pressed={filter === status} onClick={() => changeFilter(status)}>{status === "all" ? "All entries" : status === "outstanding" ? "Outstanding" : "Settled"}</button>)}</div></div>
    {history.loading ? <p className="history-message" role="status">Loading credit entries…</p> : history.error ? <div className="form-error" role="alert">{history.error}<button className="text-button" onClick={history.retry}>Try credit history again</button></div> : !history.rows.length ? <div className="history-message"><h3>{page ? "No more entries on this page." : filter === "outstanding" ? "No outstanding credit entries." : filter === "settled" ? "No settled credit entries yet." : "No credit purchases yet."}</h3><p>{filter === "settled" ? "Entries move here when the accounts office records settlement." : "Orders paid through credit will appear in this ledger."}</p></div> : <div className="history-table-wrap"><table className="history-table credit-table"><caption className="sr-only">{filter === "all" ? "All" : filter} credit purchases</caption><thead><tr><th scope="col">Purchase</th><th scope="col">Billing month</th><th scope="col">Status & settlement</th><th scope="col" className="amount-column">Amount</th></tr></thead><tbody>{history.rows.map(entry => <tr key={entry.id}><th scope="row" data-label="Purchase"><strong>Order #{entry.order_id}</strong><small><time dateTime={entry.created_at}>{nepalTime(entry.created_at)}</time></small></th><td data-label="Billing month"><time dateTime={entry.month}>{entry.month}</time></td><td data-label="Status & settlement"><span className={`credit-status ${entry.status}`}>{entry.status === "settled" ? "Settled" : "Outstanding"}</span>{entry.settled_at && <small>Recorded <time dateTime={entry.settled_at}>{nepalTime(entry.settled_at)}</time></small>}{entry.settlement_reference && <small>{entry.settlement_reference}</small>}</td><td data-label="Amount" className="amount-column">{rupees(entry.amount)}</td></tr>)}</tbody></table></div>}
    <HistoryPagination page={page} hasMore={history.hasMore} loading={history.loading} onPage={setPage} />
    <p className="history-footnote">The amount is the original credit purchase. Settled entries are no longer part of your outstanding dues.</p>
  </section>;
}
