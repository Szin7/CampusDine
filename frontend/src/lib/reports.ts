export type SalesPeriod = { period: string; order_count: number; sales_amount: number; wallet_sales: number; credit_sales: number };
export type SalesReport = { currency: "NPR"; amount_unit: "paisa"; start_date: string; end_date: string; order_count: number; sales_amount: number; wallet_sales: number; credit_sales: number; periods: SalesPeriod[] };
export type ReportQuery = { mode: "daily"; start: string; end: string } | { mode: "monthly"; year: number };
export function nepalToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kathmandu", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string) => parts.find(part => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}
export function periodLabel(period: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...(period.length === 7 ? {} : { day: "2-digit" as const }), month: "short", year: "numeric" }).format(new Date(`${period.length === 7 ? `${period}-01` : period}T00:00:00Z`));
}
export function reportPath(query: ReportQuery): string {
  return query.mode === "monthly" ? `/admin/reports/monthly?year=${query.year}` : `/admin/reports/daily?start_date=${query.start}&end_date=${query.end}`;
}
