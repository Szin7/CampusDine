export type Dues = { student_id: number; roll_no: string; name: string; department: string; month: string; amount: number; ledger_ids: number[] };
export type SettlementBody = { request_key: string; student_id: number; ledger_ids: number[]; expected_amount: number; reference: string };
export type Settlement = { request_key: string; student_id: number; admin_id: number; amount: number; ledger_ids: number[]; reference: string; created_at: string };
export type PendingSettlement = { name: string; roll: string; month: string; body: SettlementBody };
export const settlementKey = (adminId: number) => `campusdine:admin:${adminId}:pending-settlement`;
export function readPendingSettlement(adminId: number): PendingSettlement | null {
  const raw = sessionStorage.getItem(settlementKey(adminId));
  if (!raw) return null;
  const value = JSON.parse(raw) as PendingSettlement;
  const b = value.body;
  if (typeof value.name !== "string" || typeof value.roll !== "string" || typeof value.month !== "string" ||
      !b || !Number.isSafeInteger(b.student_id) || b.student_id < 1 || !Number.isSafeInteger(b.expected_amount) || b.expected_amount < 1 ||
      b.expected_amount > 2147483647 || typeof b.reference !== "string" || !b.reference.trim() || b.reference.length > 120 ||
      typeof b.request_key !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(b.request_key) || !Array.isArray(b.ledger_ids) ||
      b.ledger_ids.length < 1 || b.ledger_ids.length > 500 || b.ledger_ids.some(id => !Number.isSafeInteger(id) || id < 1) ||
      new Set(b.ledger_ids).size !== b.ledger_ids.length) throw new Error("Invalid saved settlement");
  return value;
}
