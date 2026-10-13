"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AuthAside } from "@/components/AuthAside";
import { FaceCapture } from "@/components/FaceCapture";
import { PasswordField } from "@/components/PasswordField";
import { useSession } from "@/components/SessionProvider";
import { api, type Role, type Session } from "@/lib/api";
const roles: { value: Role; label: string }[] = [{ value: "student", label: "Student" }, { value: "staff", label: "Canteen staff" }, { value: "admin", label: "Admin" }];
export default function SignIn() {
  const [role, setRole] = useState<Role>("student");
  const [faceEnabled, setFaceEnabled] = useState(false);
  const [faceMode, setFaceMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);
  const { session, loading, setSession } = useSession();
  const router = useRouter();
  useEffect(() => {
    const controller = new AbortController();
    api<{ student_face_login: boolean }>("/auth/methods", { signal: controller.signal })
      .then(methods => { if (!controller.signal.aborted) setFaceEnabled(methods.student_face_login); })
      .catch(() => {}); // Password login stays available if capability lookup fails.
    return () => controller.abort();
  }, []);
  async function faceSignIn(photo: File) {
    if (submitting.current || loading || session) return;
    submitting.current = true; setBusy(true); setError("");
    const body = new FormData(); body.append("face_photo", photo);
    try { setSession(await api<Session>("/auth/face-login", { method: "POST", body })); }
    catch (err) { setError((err as Error).message); }
    finally { submitting.current = false; setBusy(false); }
  }
  useEffect(() => { if (session) router.replace(session.role === "student" ? "/menu" : session.role === "admin" ? "/admin/students" : "/staff/counter"); }, [session, router]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || faceMode || loading || session) return;
    submitting.current = true; setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const account = await api<Session>("/auth/login", { method: "POST", body: JSON.stringify({ role, username: String(form.get("username")).trim(), password: form.get("password") }) });
      setSession(account);
    } catch (err) { setError((err as Error).message); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <main id="main" className="auth-layout"><AuthAside /><section className="sign-in-panel">
    <div className="form-heading"><p className="eyebrow">YOUR CANTEEN ACCOUNT</p><h2>Good to see you.</h2><p>Sign in to pick up where you left off.</p></div>
    <form onSubmit={signIn} aria-busy={busy}>
      <fieldset className="role-picker" disabled={busy}><legend className="sr-only">Account role</legend>{roles.map(({ value, label }) => <label key={value}><input type="radio" name="role" value={value} checked={role === value} onChange={() => { setRole(value); setFaceMode(false); setError(""); }} /><span>{label}</span></label>)}</fieldset>
      {role === "student" && faceEnabled && <div className="camera-actions" role="group" aria-label="Sign-in method">
        <button type="button" className="secondary-button" aria-pressed={!faceMode} disabled={busy} onClick={() => { setFaceMode(false); setError(""); }}>Password login</button>
        <button type="button" className="secondary-button" aria-pressed={faceMode} disabled={busy} onClick={() => { setFaceMode(true); setError(""); }}>Face login</button>
      </div>}
      {error && <div className="form-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</div>}
      {faceMode && role === "student" ? <FaceCapture login busy={busy || loading || !!session} identify={photo => void faceSignIn(photo)} /> : <fieldset disabled={busy} className="form-fields">
        <label className="field"><span>{role === "student" ? "Roll number" : "Username"}</span><input name="username" required maxLength={80} autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder={role === "student" ? "Your college roll number" : "Your assigned username"} /></label>
        <PasswordField />
        <button className="primary-button" disabled={loading || !!session} type="submit">{busy ? "Signing in…" : loading ? "Checking session…" : "Sign in"}<span aria-hidden="true">→</span></button>
      </fieldset>}
    </form>
    <p className="help-note">{role === "student" ? "Your enrollment needs admin approval before you can sign in." : "Use the account assigned to you by the canteen administrator."}</p>
    <div className="enroll-link"><span>New to the canteen?</span><Link href="/enroll">Enroll as a student <span aria-hidden="true">↗</span></Link></div>
    <p className="small-note">Forgot your password? Contact the accounts office.</p>
  </section></main>;
}
