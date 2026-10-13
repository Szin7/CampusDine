"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PasswordField } from "@/components/PasswordField";
import { api, type Student } from "@/lib/api";
export default function Enroll() {
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [enrolled, setEnrolled] = useState<Student | null>(null);
  const submitting = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!photo) { setPreview(""); return; }
    const url = URL.createObjectURL(photo); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  useEffect(() => { if (enrolled) successRef.current?.focus(); }, [enrolled]);
  function choosePhoto(file: File | undefined, input: HTMLInputElement) {
    setPhoto(null); setPhotoError("");
    if (!file) return;
    if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setPhotoError("Choose a JPEG or PNG photo no larger than 5 MB."); input.value = ""; return;
    }
    setPhoto(file);
  }
  async function enroll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    if (!photo) { setPhotoError("Choose your face photo before submitting."); return; }
    submitting.current = true; setBusy(true); setError("");
    const form = event.currentTarget;
    const data = new FormData(form); data.delete("face_consent");
    try { setEnrolled(await api<Student>("/students/enroll", { method: "POST", body: data })); form.reset(); setPhoto(null); }
    catch (err) { setError((err as Error).message); }
    finally { submitting.current = false; setBusy(false); }
  }
  if (enrolled) return <main id="main" className="enrollment-success"><p className="eyebrow">ENROLLMENT RECEIVED</p><span className="status-label">Awaiting admin approval</span><h1 ref={successRef} tabIndex={-1}>You’re on the list,<br /><em>{enrolled.name.split(" ")[0]}.</em></h1><p>Your enrollment for <strong>{enrolled.roll_no}</strong> has been submitted. An administrator will review it before your account becomes active.</p><p>You can sign in after approval. If you need help, contact the accounts office with your roll number.</p><Link className="primary-button" href="/sign-in">Back to sign in <span aria-hidden="true">→</span></Link></main>;
  return <main id="main" className="enrollment-layout"><aside className="enrollment-aside"><Link className="back-link" href="/sign-in">← Back to sign in</Link><p className="eyebrow">STUDENT ENROLLMENT</p><h1>Make it<br /> <em>your canteen.</em></h1><p>One account for your orders, wallet and monthly dues.</p><ol className="enrollment-steps"><li><span>01</span><div><strong>Add your details</strong><p>Use your college roll number.</p></div></li><li><span>02</span><div><strong>Include a face photo</strong><p>We’ll use it for counter identification and face login when enabled.</p></div></li><li><span>03</span><div><strong>Wait for approval</strong><p>An admin checks every enrollment.</p></div></li></ol><div className="counter-note">Face not recognised at the counter? Canteen staff can look you up by roll number.</div></aside>
  <section className="enrollment-form"><div className="form-heading"><p className="eyebrow">NATIONAL COLLEGE OF ENGINEERING</p><h2>Your student details</h2><p>All fields are required.</p></div>
  <form onSubmit={enroll} aria-busy={busy}>{error && <div className="form-error" role="alert" tabIndex={-1} ref={errorRef}>{error}</div>}<fieldset disabled={busy} className="form-fields">
    <div className="grid gap-5 sm:grid-cols-2"><label className="field"><span>Full name</span><input name="name" required maxLength={120} autoComplete="name" placeholder="As registered with the college" /></label><label className="field"><span>Roll number</span><input name="roll_no" required maxLength={40} pattern="[A-Za-z0-9\/\-]+" autoCapitalize="characters" spellCheck={false} placeholder="College roll number" /></label></div>
    <div className="grid gap-5 sm:grid-cols-[1fr_140px]"><label className="field"><span>Department</span><input name="department" required maxLength={100} placeholder="e.g. Computer Engineering" /></label><div className="field"><label htmlFor="semester">Semester</label><select id="semester" name="semester" required defaultValue=""><option value="" disabled>Select</option>{[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}</option>)}</select></div></div>
    <div className="field"><label htmlFor="email">Email address</label><input id="email" name="email" type="email" required maxLength={254} autoComplete="email" placeholder="The inbox you check regularly" /><small>Ready-order alerts and monthly dues will go here.</small></div>
    <PasswordField enrollment />
    <div className="photo-section"><div className="field"><label htmlFor="face-photo">Face photo</label><small id="photo-hint">Face the camera in good light. One person, no face covering. JPEG or PNG, up to 5 MB and 16 megapixels.</small><input id="face-photo" name="face_photo" type="file" accept="image/jpeg,image/png" required aria-describedby="photo-hint photo-error" onChange={e => choosePhoto(e.target.files?.[0], e.target)} /></div>{preview && <div className="photo-preview"><img src={preview} alt="Your selected enrollment photo" /><span>{photo?.name}<small>Ready to submit</small></span></div>}<p id="photo-error" className="inline-error" role="alert">{photoError}</p></div>
    <label className="consent"><input name="face_consent" type="checkbox" required /><span>I agree to use my face photo for identification at the canteen and face login when enabled. CampusDine stores a numerical face encoding; the uploaded photo is not saved.</span></label>
    <button className="primary-button" type="submit">{busy ? "Submitting enrollment…" : "Submit for approval"}<span aria-hidden="true">→</span></button>
  </fieldset></form></section></main>;
}
