export type Role = "student" | "staff" | "admin";
export type Session = { id: number; name: string; role: Role; csrf_token: string };
export type Student = {
  id: number; name: string; roll_no: string; department: string; semester: number;
  email: string; approval_status: string; is_active: boolean;
  wallet_balance: number; credit_balance: number; credit_limit: number;
};
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function api<T>(path: string, options: RequestInit = {}, csrfToken?: string): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { ...options, headers, credentials: "same-origin", cache: "no-store" });
  } catch {
    throw new ApiError("Cannot reach the canteen server. Check your connection and try again.", 0);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const detail = data?.detail;
    const message = typeof detail === "string" ? detail : Array.isArray(detail)
      ? detail.map((issue: { loc?: string[]; msg: string }) => `${String(issue.loc?.at(-1) ?? "Field").replaceAll("_", " ")}: ${issue.msg}`).join(". ")
      : "The canteen server could not complete this request. Please try again.";
    throw new ApiError(message, response.status);
  }
  return response.status === 204 ? undefined as T : response.json();
}
export const rupees = (paisa: number) => `NPR ${(paisa / 100).toLocaleString("en-NP", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export type MenuItem = { id: number; name: string; price: number; category: string; is_available: boolean; is_archived: boolean };
export type RecommendationSource = "usual" | "collaborative" | "popular" | "menu";
export type Recommendations = { items: { item: MenuItem; source: RecommendationSource }[] };
export async function readMenu(signal?: AbortSignal): Promise<MenuItem[]> {
  const items = new Map<number, MenuItem>();
  for (let offset = 0; ; offset += 200) {
    const page = await api<MenuItem[]>(`/menu?limit=200&offset=${offset}`, { signal });
    for (const item of page) if (!item.is_archived) items.set(item.id, item);
    if (page.length < 200) break;
  }
  return [...items.values()];
}
export type CheckoutBody = { checkout_key: string; expected_total: number; items: { menu_item_id: number; quantity: number }[] };
export type Order = { id: number; student_id: number; student_name: string; token_number: number; order_date: string; status: string; total_amount: number; payment_type: "wallet" | "credit"; created_at: string; revision: number; items: { menu_item_id: number; item_name: string; unit_price: number; quantity: number }[] };
export type AccountSummary = { student_id: number; roll_no: string; name: string; wallet_balance: number; credit_balance: number; credit_limit: number; remaining_credit: number };
export type WalletTransaction = { id: number; student_id: number; amount: number; type: string; order_id: number | null; admin_id: number | null; reference: string | null; timestamp: string };
export type CreditEntry = { id: number; student_id: number; order_id: number; amount: number; status: "outstanding" | "settled"; month: string; created_at: string; settled_at: string | null; settlement_reference: string | null };
export const nepalTime = (timestamp: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kathmandu", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(timestamp));
