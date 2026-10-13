"use client";
import { useEffect, useRef, useState } from "react";
import { rupees } from "@/lib/api";
import { periodLabel, type SalesPeriod } from "@/lib/reports";
export function SalesChart({ periods, maximum }: { periods: SalesPeriod[]; maximum: number }) {
  const [selected, setSelected] = useState(periods.reduce((best, row) => row.sales_amount > best.sales_amount ? row : best, periods[0]));
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const center = () => {
      const container = scroll.current;
      const column = container?.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (container && column) container.scrollLeft += column.getBoundingClientRect().left - container.getBoundingClientRect().left - container.clientWidth / 2 + column.clientWidth / 2;
    };
    center();
    window.addEventListener("resize", center);
    return () => window.removeEventListener("resize", center);
  }, []);
  // One axis for the whole report keeps chart pages comparable; amounts remain integer paisa.
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(maximum, 100)));
  const ceiling = Math.ceil(Math.max(maximum, 100) / magnitude) * magnitude;
  return <div className="sales-chart">
    <div className="sales-legend"><span><i className="wallet-swatch" />Wallet-funded</span><span><i className="credit-swatch" />Credit-funded</span><span>Scale in NPR · starts at zero</span></div>
    <div ref={scroll} className="sales-chart-scroll" role="region" aria-label="Sales chart; scroll horizontally for all periods" tabIndex={0}>
      <div className="sales-chart-canvas" style={{ minWidth: Math.max(560, periods.length * 32 + 100) }}>
        <div className="sales-axis" aria-hidden="true">{[1, .75, .5, .25, 0].map(fraction => <span key={fraction}>{(ceiling * fraction / 100).toLocaleString("en-NP", { maximumFractionDigits: 2 })}</span>)}</div>
        <div className="sales-plot"><div className="sales-grid" aria-hidden="true">{[0, 1, 2, 3, 4].map(line => <span key={line} />)}</div><div className="sales-columns">{periods.map(row => <div className="sales-column" key={row.period}><button type="button" className="sales-bar" aria-pressed={selected.period === row.period} aria-label={`${periodLabel(row.period)}: ${row.order_count} orders, ${rupees(row.sales_amount)} sales, wallet ${rupees(row.wallet_sales)}, credit ${rupees(row.credit_sales)}`} onClick={() => setSelected(row)} onFocus={() => setSelected(row)}><span className="sales-stack" style={{ height: `${row.sales_amount / ceiling * 100}%` }} aria-hidden="true"><span className="credit-segment" style={{ flex: row.credit_sales }} /><span className="wallet-segment" style={{ flex: row.wallet_sales }} /></span></button><span className="sales-x-label" aria-hidden="true">{row.period.length === 7 ? periodLabel(row.period).slice(0, 3) : row.period.slice(8)}</span></div>)}</div></div>
      </div>
    </div>
    <div className="sales-chart-detail" role="status"><strong>{periodLabel(selected.period)}</strong><span>{selected.order_count} orders · {rupees(selected.sales_amount)}</span><span>Wallet {rupees(selected.wallet_sales)} · Credit {rupees(selected.credit_sales)}</span></div>
    <p className="history-footnote">Select or focus a column for exact values. Scroll horizontally on smaller screens. Zero-sales periods stay in the timeline. The table below contains the same figures.</p>
  </div>;
}
