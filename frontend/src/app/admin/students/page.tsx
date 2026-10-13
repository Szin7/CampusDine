"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/SessionProvider";
import { StudentReview } from "@/components/StudentReview";
import { api, ApiError, type Student } from "@/lib/api";
type EnrollmentFilter = "pending" | "approved" | "rejected" | "all";
export default function Students() {
  const { setSession } = useSession();
  const router = useRouter();
  const [status, setStatus] = useState<EnrollmentFilter>("pending");
  const [access, setAccess] = useState("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<{ key: string; rows: Student[]; hasMore: boolean; error: string } | null>(null);
  const parameters = new URLSearchParams({ status, limit: "21", offset: String(page * 20) });
  if (query) parameters.set("q", query);
  if (access !== "all") parameters.set("is_active", access);
  const path = `/admin/students?${parameters}`;
  const key = `${path}:${reload}`;
  const expired = useCallback(() => { setSession(null); router.replace("/sign-in"); }, [setSession, router]);
  const changed = useCallback(() => setReload(value => value + 1), []);
  useEffect(() => {
    const abort = new AbortController();
    api<Student[]>(path, { signal: abort.signal }).then(rows => {
      if (!abort.signal.aborted) setResult({ key, rows: rows.slice(0, 20), hasMore: rows.length > 20, error: "" });
    }).catch(err => {
      if (abort.signal.aborted) return;
      if (err instanceof ApiError && [401, 403].includes(err.status)) expired();
      else setResult({ key, rows: [], hasMore: false, error: (err as Error).message });
    });
    return () => abort.abort();
  }, [path, key, expired]);
  const loading = result?.key !== key;
  const rows = loading ? [] : result.rows;
  function searchStudents(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setQuery(search.trim()); setPage(0); }
  return <main id="main" className="admin-students"><div className="admin-page-heading"><div><p className="eyebrow">ENROLLMENT & ACCOUNT ACCESS</p><h1>Students</h1><p>Review new enrollments and keep student records up to date.</p></div><p className="admin-page-note">National College of Engineering<br />One college. One student register.</p></div>
    <form className="student-search" onSubmit={searchStudents}><label className="field"><span>Find a student</span><input type="search" maxLength={120} value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or roll number" /></label><button className="primary-button" type="submit">Search</button></form>
    <div className="student-filters"><div className="category-filters" aria-label="Enrollment status">{(["pending", "approved", "rejected", "all"] as const).map(value => <button key={value} aria-pressed={status === value} onClick={() => { setStatus(value); setPage(0); }}>{value === "pending" ? "Pending review" : value === "approved" ? "Approved" : value === "rejected" ? "Rejected" : "All students"}</button>)}</div><label className="access-filter"><span>Account access</span><select value={access} onChange={e => { setAccess(e.target.value); setPage(0); }}><option value="all">All accounts</option><option value="true">Enabled</option><option value="false">Suspended</option></select></label></div>
    {loading ? <p className="history-message" role="status">Loading student records…</p> : result.error ? <div className="form-error" role="alert">{result.error}<button className="text-button" onClick={changed}>Try loading students again</button></div> : !rows.length ? <div className="history-message"><h2>{query || access !== "all" || page ? "No students match this page." : status === "pending" ? "No enrollments waiting for review." : "No student records in this view."}</h2><p>{query || access !== "all" ? "Try another name, roll number or access filter." : "New student enrollments will appear here for an administrator to review."}</p></div> : <><p className="student-list-count" role="status">Showing {page * 20 + 1}–{page * 20 + rows.length}{query && ` matching “${query}”`}</p><div className="history-table-wrap"><table className="history-table students-table"><caption className="sr-only">Student register</caption><thead><tr><th scope="col">Student</th><th scope="col">Department</th><th scope="col">Enrollment</th><th scope="col">Account</th><th scope="col">Action</th></tr></thead><tbody>{rows.map(student => <tr key={student.id}><th scope="row" data-label="Student"><strong>{student.name}</strong><small>{student.roll_no}</small></th><td data-label="Department">{student.department}<small>Semester {student.semester}</small></td><td data-label="Enrollment"><span className={`enrollment-status ${student.approval_status}`}>{student.approval_status === "pending" ? "Pending review" : student.approval_status === "approved" ? "Approved" : "Rejected"}</span></td><td data-label="Account">{student.is_active ? "Enabled" : "Suspended"}</td><td data-label="Action"><button className="review-student-button" aria-label={`View student ${student.roll_no}`} onClick={() => setSelected(student.id)}>{student.approval_status === "pending" ? "Review" : "View details"} →</button></td></tr>)}</tbody></table></div></>}
    {(page > 0 || (!loading && result.hasMore)) && <nav className="history-pagination" aria-label="Student pages"><button className="secondary-button" disabled={loading || !page} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page + 1}</span><button className="secondary-button" disabled={loading || !result?.hasMore} onClick={() => setPage(value => value + 1)}>Next</button></nav>}
    <p className="history-footnote">Students need both an approved enrollment and an enabled account to sign in. Suspending an account keeps its orders and balances on record.</p>
    {selected !== null && <StudentReview key={selected} studentId={selected} close={() => setSelected(null)} changed={changed} expired={expired} />}
  </main>;
}
