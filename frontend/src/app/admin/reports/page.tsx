"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, rupees } from "@/lib/api";
import { nepalToday, periodLabel, reportPath, type ReportQuery, type SalesReport } from "@/lib/reports";
import { useSession } from "@/components/SessionProvider";
import { SalesChart } from "@/components/SalesChart";
export default function Reports() {
  const { setSession } = useSession();
  const router = useRouter();
  const [mode, setMode] = useState<"daily" | "monthly">("daily");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [year, setYear] = useState("");
  const [query, setQuery] = useState<ReportQuery | null>(null);
  const [validation, setValidation] = useState("");
  const [reload, setReload] = useState(0);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<{ key: string; report: SalesReport | null; error: string } | null>(null);
  const expired = useCallback(() => { setSession(null); router.replace("/sign-in"); }, [setSession, router]);
  useEffect(() => {
    const today = nepalToday(), first = `${today.slice(0, 7)}-01`;
    setStart(first); setEnd(today); setYear(today.slice(0, 4)); setQuery({ mode: "daily", start: first, end: today });
  }, []);
  const path = query ? reportPath(query) : null;
  const key = `${path}:${reload}`;
  useEffect(() => {
    if (!path) return;
    const abort = new AbortController();
    api<SalesReport>(path, { signal: abort.signal }).then(report => { if (!abort.signal.aborted) setResult({ key, report, error: "" }); }).catch(err => {
      if (abort.signal.aborted) return;
      if (err instanceof ApiError && [401, 403].includes(err.status)) expired(); else setResult({ key, report: null, error: (err as Error).message });
    });
    return () => abort.abort();
  }, [path, key, expired]);
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setValidation("");
    if (mode === "daily") {
      const days = (Date.parse(end) - Date.parse(start)) / 86400000;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || !Number.isFinite(days) || days < 0 || days > 365) {
        setValidation("Choose 1 to 366 days, with the start date no later than the end date."); return;
      }
      setQuery({ mode, start, end });
    } else {
      if (!/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > 9999) { setValidation("Choose a year between 1900 and 9999."); return; }
      setQuery({ mode, year: Number(year) });
    }
    setPage(0); setReload(value => value + 1);
  }
  function preset(todayOnly: boolean) {
    const today = nepalToday(), first = todayOnly ? today : `${today.slice(0, 7)}-01`;
    setMode("daily"); setStart(first); setEnd(today); setQuery({ mode: "daily", start: first, end: today }); setPage(0); setValidation(""); setReload(value => value + 1);
  }
  const loading = !path || result?.key !== key;
  const report = loading ? null : result.report;
  const error = loading ? "" : result.error;
  const periods = report?.periods.slice(page * 31, (page + 1) * 31) ?? [];
  const pages = Math.ceil((report?.periods.length ?? 0) / 31);
  const label = report ? `${periodLabel(report.start_date)} – ${periodLabel(report.end_date)}` : "";
  return <main id="main" className="admin-students sales-page"><div className="admin-page-heading"><div><p className="eyebrow">CANTEEN PERFORMANCE</p><h1>Sales overview</h1><p>Orders and sales, with a clear view of how students paid.</p></div><button className="secondary-button" disabled={loading} onClick={() => setReload(value => value + 1)}>Refresh report</button></div>
    <section className="sales-controls" aria-label="Report filters"><div className="category-filters" aria-label="Report frequency"><button aria-pressed={mode === "daily"} onClick={() => setMode("daily")}>Daily</button><button aria-pressed={mode === "monthly"} onClick={() => setMode("monthly")}>Monthly</button></div><form onSubmit={apply} className="sales-filter-form">{mode === "daily" ? <><label className="field"><span>Start date</span><input type="date" required value={start} onChange={event => setStart(event.target.value)} /></label><label className="field"><span>End date</span><input type="date" required value={end} onChange={event => setEnd(event.target.value)} /></label></> : <label className="field"><span>Report year</span><input type="number" min={1900} max={9999} step={1} required value={year} onChange={event => setYear(event.target.value)} /></label>}<button className="primary-button" disabled={!query}>Apply report</button></form><div className="sales-presets"><button className="text-button" onClick={() => preset(true)}>Today in Nepal</button><button className="text-button" onClick={() => preset(false)}>Month to date</button></div>{validation && <p className="form-error" role="alert">{validation}</p>}</section>
    {loading ? <p className="history-message" role="status">Loading sales report…</p> : error ? <div className="form-error" role="alert">{error}<button className="text-button" onClick={() => setReload(value => value + 1)}>Retry sales report</button></div> : report && <>
      <div className="sales-period-heading"><h2>{query?.mode === "monthly" ? "Monthly sales" : "Daily sales"}</h2><p>{label}<span>Order dates in Asia/Kathmandu · NPR</span></p></div>
      <dl className="sales-kpis"><div className="sales-kpi-primary"><dt>Total sales</dt><dd>{rupees(report.sales_amount)}</dd><small>Confirmed orders in this period</small></div><div><dt>Orders placed</dt><dd>{report.order_count.toLocaleString("en-NP")}</dd><small>{report.order_count ? `Average order ${rupees(Math.round(report.sales_amount / report.order_count))}` : "Average order —"}</small></div><div><dt>Wallet-funded sales</dt><dd>{rupees(report.wallet_sales)}</dd><small>Paid from prepaid balances</small></div><div><dt>Credit-funded sales</dt><dd>{rupees(report.credit_sales)}</dd><small>Credit used at checkout</small></div></dl>
      {!report.order_count && <p className="sales-empty" role="status">No sales recorded for this period. All totals are zero.</p>}
      <section className="sales-trend" aria-label="Sales trend"><div className="history-heading"><div><p className="eyebrow">SALES BY PAYMENT SOURCE</p><h2>{query?.mode === "monthly" ? "The year at a glance" : "Day by day"}</h2></div><span>{periods.length ? `${periodLabel(periods[0].period)} – ${periodLabel(periods.at(-1)!.period)}` : ""}</span></div>
        {periods.length > 0 && <SalesChart key={`${key}-${page}`} periods={periods} maximum={Math.max(...report.periods.map(row => row.sales_amount))} />}
        {pages > 1 && <nav className="history-pagination" aria-label="Report period pages"><button className="secondary-button" disabled={page === 0} onClick={() => setPage(value => value - 1)}>Previous periods</button><span>Page {page + 1} of {pages} · 31 periods per page</span><button className="secondary-button" disabled={page + 1 >= pages} onClick={() => setPage(value => value + 1)}>Next periods</button></nav>}
      </section>
      <section className="account-history"><div className="history-heading"><h2>Exact figures</h2><span>Same periods as the chart</span></div><div className="history-table-wrap"><table className="history-table"><caption className="sr-only">Sales by period</caption><thead><tr><th scope="col">Period</th><th scope="col">Orders</th><th scope="col">Wallet</th><th scope="col">Credit</th><th scope="col">Total sales</th></tr></thead><tbody>{periods.map(row => <tr key={row.period}><th scope="row" data-label="Period">{periodLabel(row.period)}</th><td data-label="Orders">{row.order_count}</td><td data-label="Wallet">{rupees(row.wallet_sales)}</td><td data-label="Credit">{rupees(row.credit_sales)}</td><td data-label="Total sales">{rupees(row.sales_amount)}</td></tr>)}</tbody></table></div></section>
      <div className="accounts-office-note"><strong>What counts as a sale?</strong><p>Sales are the original order totals, including orders still being prepared. Wallet top-ups and credit settlements are not extra sales. Credit-funded sales are not the current outstanding dues; use Billing to review those.</p></div>
    </>}
  </main>;
}
