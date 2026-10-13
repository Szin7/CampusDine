import { StudentNavigation, type StudentPage } from "@/components/StudentNavigation";
import { rupees, type Student } from "@/lib/api";
export function StudentBalances({ student, error, retry, active = "/menu" }: { student: Pick<Student, "wallet_balance" | "credit_limit" | "credit_balance"> | null; error: string; retry: () => void; active?: StudentPage }) {
  return <div className="student-toolbar"><StudentNavigation active={active} />
    <div className="student-money" aria-label="Your canteen balances">
      {error ? <div className="balance-error" role="alert">Balances unavailable. <button onClick={retry}>Try again</button></div> : <>
        <div><span>Wallet</span><strong>{student ? rupees(student.wallet_balance) : "Loading…"}</strong></div>
        <div><span>Available credit</span><strong>{student ? rupees(student.credit_limit - student.credit_balance) : "Loading…"}</strong></div>
      </>}
    </div>
  </div>;
}
