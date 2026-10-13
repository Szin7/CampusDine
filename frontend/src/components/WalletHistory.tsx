"use client";
import { useState } from "react";
import { nepalTime, rupees, type WalletTransaction } from "@/lib/api";
import { useHistoryPage } from "@/lib/useHistoryPage";
import { HistoryPagination } from "./HistoryPagination";
export function WalletHistory({ onSessionExpired, path = "/wallet/transactions" }: { onSessionExpired: () => void; path?: string }) {
  const [page, setPage] = useState(0);
  const history = useHistoryPage<WalletTransaction>(path, page, onSessionExpired);
  return <section className="account-history" aria-labelledby="wallet-history-title"><div className="history-heading"><div><p className="eyebrow">MONEY IN / MEALS OUT</p><h2 id="wallet-history-title">Wallet activity</h2></div><span>Dates shown in Nepal time</span></div>
    {history.loading ? <p className="history-message" role="status">Loading wallet activity…</p> : history.error ? <div className="form-error" role="alert">{history.error}<button className="text-button" onClick={history.retry}>Try wallet history again</button></div> : !history.rows.length ? <div className="history-message"><h3>{page ? "No more entries on this page." : "No wallet activity yet."}</h3><p>Top-ups and purchases paid from your wallet will appear here.</p></div> : <div className="history-table-wrap"><table className="history-table"><caption className="sr-only">Wallet top-ups and order debits</caption><thead><tr><th scope="col">Activity</th><th scope="col">Date & time</th><th scope="col">Reference</th><th scope="col" className="amount-column">Amount</th></tr></thead><tbody>{history.rows.map(entry => <tr key={entry.id}><th scope="row" data-label="Activity"><strong>{entry.type === "top_up" ? "Wallet top-up" : "Canteen purchase"}</strong><small>{entry.order_id ? `Order #${entry.order_id}` : "Recorded by accounts"}</small></th><td data-label="Date & time"><time dateTime={entry.timestamp}>{nepalTime(entry.timestamp)}</time></td><td data-label="Reference">{entry.reference || "—"}</td><td data-label="Amount" className={`amount-column ${entry.amount > 0 ? "money-in" : ""}`}>{entry.amount > 0 ? "+" : "−"}{rupees(Math.abs(entry.amount))}</td></tr>)}</tbody></table></div>}
    <HistoryPagination page={page} hasMore={history.hasMore} loading={history.loading} onPage={setPage} />
  </section>;
}
