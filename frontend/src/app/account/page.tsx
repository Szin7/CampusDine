"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession } from "@/components/SessionProvider";
import { api, ApiError, rupees, type Student } from "@/lib/api";
export default function Account() {
  const { session, loading, error, setSession, refresh } = useSession();
  const [student, setStudent] = useState<Student | null>(null);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  useEffect(() => { if (!loading && !session && !error) router.replace("/sign-in"); }, [session, loading, error, router]);
  useEffect(() => {
    if (session?.role !== "student") return;
    let active = true;
    api<Student>("/students/me").then(data => { if (active) setStudent(data); }).catch(err => {
      if (!active) return;
      if (err instanceof ApiError && err.status === 401) { setSession(null); router.replace("/sign-in"); }
      else setActionError(err.message);
    });
    return () => { active = false; };
  }, [session, setSession, router]);
  async function signOut() {
    if (!session) return;
    setBusy(true); setActionError("");
    try { await api("/auth/logout", { method: "POST" }, session.csrf_token); setSession(null); setStudent(null); router.replace("/sign-in"); }
    catch (err) {
      if (err instanceof ApiError && err.status === 401) { setSession(null); setStudent(null); router.replace("/sign-in"); }
      else setActionError((err as Error).message);
    } finally { setBusy(false); }
  }
  return <main id="main" className="account-page">{loading ? <p role="status">Checking your account…</p> : error ? <div className="form-error" role="alert">{error}<button className="text-button" onClick={() => void refresh()}>Try again</button><Link href="/sign-in">Back to sign in</Link></div> : session && <>
    <div className="account-heading"><div><p className="eyebrow">{session.role === "staff" ? "CANTEEN STAFF" : session.role.toUpperCase()} ACCOUNT</p><h1>{session.name}</h1></div><button className="secondary-button" disabled={busy} onClick={signOut}>{busy ? "Signing out…" : "Sign out"}</button></div>
    {actionError && <div className="form-error" role="alert">{actionError}<button className="text-button" onClick={() => { setActionError(""); void refresh(); }}>Reload account</button></div>}
    {session.role === "student" && !student && !actionError && <p role="status">Loading your student details…</p>}
    {student && <><div className="balance-strip"><div><span>Wallet balance</span><strong>{rupees(student.wallet_balance)}</strong></div><div><span>Available credit</span><strong>{rupees(student.credit_limit - student.credit_balance)}</strong></div><div><span>Outstanding dues</span><strong>{rupees(student.credit_balance)}</strong></div></div><dl className="student-details"><div><dt>Roll number</dt><dd>{student.roll_no}</dd></div><div><dt>Department</dt><dd>{student.department}</dd></div><div><dt>Semester</dt><dd>{student.semester}</dd></div><div><dt>Email</dt><dd>{student.email}</dd></div></dl></>}
    {session.role === "student" && <div className="account-links"><Link href="/menu" className="back-link account-menu-link">Browse the canteen menu →</Link><Link href="/orders" className="back-link account-menu-link">Track your orders →</Link><Link href="/wallet" className="back-link account-menu-link">Wallet & credit history →</Link></div>}
    {session.role === "admin" && <Link href="/admin/students" className="back-link account-menu-link">Manage student enrollments →</Link>}
    {session.role === "staff" && <Link href="/staff/counter" className="back-link account-menu-link">Open canteen counter →</Link>}
    <p className="account-note">For account corrections or access help, contact the accounts office at National College of Engineering.</p>
  </>}</main>;
}
