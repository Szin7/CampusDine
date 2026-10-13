"use client";
import { useState } from "react";
import { nepalTime, rupees } from "@/lib/api";
import type { Settlement } from "@/lib/billing";
import { useHistoryPage } from "@/lib/useHistoryPage";
import { HistoryPagination } from "./HistoryPagination";
export function SettlementHistory({ student, expired, clear }: { student: { id: number; label: string } | null; expired: () => void; clear: () => void }) {
  const [page, setPage] = useState(0);
  const history = useHistoryPage<Settlement>(`/admin/billing/settlements${student ? `?student_id=${student.id}` : ""}`, page, expired);
  return <section className="account-history" aria-label="Settlement history"><div className="history-heading"><div><p className="eyebrow">ACCOUNTS RECORD</p><h2>Settlement history</h2><p>{student ? student.label : "All students · all months"}</p></div>{student && <button className="secondary-button" onClick={clear}>Show all settlements</button>}</div>
    {history.loading ? <p role="status">Loading settlements…</p> : history.error ? <div className="form-error" role="alert">{history.error}<button className="text-button" onClick={history.retry}>Retry settlement history</button></div> : !history.rows.length ? <p className="history-message">No settlements on this page.</p> : <div className="history-table-wrap"><table className="history-table"><caption className="sr-only">Recorded settlements</caption><thead><tr><th scope="col">Reference</th><th scope="col">Student</th><th scope="col">Amount</th><th scope="col">Nepal time</th><th scope="col">Receipt details</th></tr></thead><tbody>{history.rows.map(row => <tr key={row.request_key}><th scope="row" data-label="Reference">{row.reference}</th><td data-label="Student">{student?.label ?? `Student #${row.student_id}`}</td><td data-label="Amount">{rupees(row.amount)}</td><td data-label="Nepal time">{nepalTime(row.created_at)}</td><td data-label="Receipt details"><details><summary>{row.ledger_ids.length} ledger entries</summary><p className="ledger-ids">{row.ledger_ids.join(", ")}</p><p>Admin #{row.admin_id}</p><p className="ledger-ids">Receipt: {row.request_key}</p></details></td></tr>)}</tbody></table></div>}
    <HistoryPagination page={page} hasMore={history.hasMore} loading={history.loading} onPage={setPage} />
  </section>;
}
