"use client";
import { useEffect, useRef, useState } from "react";
export function FaceCapture({ busy, identify, login = false }: { busy: boolean; identify: (photo: File) => void; login?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const [camera, setCamera] = useState(false);
  const [starting, setStarting] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  function stop() {
    generation.current++;
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    if (video.current) video.current.srcObject = null;
    setCamera(false); setStarting(false);
  }
  useEffect(() => () => { generation.current++; stream.current?.getTracks().forEach(track => track.stop()); }, []);
  useEffect(() => { if (!photo) { setPreview(""); return; } const url = URL.createObjectURL(photo); setPreview(url); return () => URL.revokeObjectURL(url); }, [photo]);
  async function start() {
    if (starting || busy) return;
    stop(); const attempt = ++generation.current; setStarting(true); setPhoto(null); setError("");
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error(`Camera requires HTTPS or localhost. ${login ? "Use your roll number and password instead." : "Use a photo or roll number instead."}`);
      const media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } } });
      if (attempt !== generation.current) { media.getTracks().forEach(track => track.stop()); return; }
      stream.current = media; setCamera(true); setStarting(false);
      if (video.current) { video.current.srcObject = media; await video.current.play(); }
    } catch (err) {
      if (attempt !== generation.current) return;
      stop(); setError(err instanceof Error && err.message.includes("HTTPS") ? err.message : (login ? "Camera could not be opened. Check permission, or use your roll number and password." : "Camera could not be opened. Check permission, or use a photo or roll-number lookup."));
    }
  }
  function choose(file: File | null) {
    stop(); setPhoto(null); setError("");
    if (!file) return;
    if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 5 * 1024 * 1024 || !file.size) { setError("Choose a JPEG or PNG photo no larger than 5 MB."); return; }
    setPhoto(file);
  }
  function capture() {
    if (!video.current?.videoWidth || busy) { setError("Wait for the camera image before capturing."); return; }
    const canvas = document.createElement("canvas"), source = video.current;
    const ratio = Math.min(1, 1200 / Math.max(source.videoWidth, source.videoHeight));
    canvas.width = Math.round(source.videoWidth * ratio); canvas.height = Math.round(source.videoHeight * ratio);
    canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
    const attempt = generation.current;
    canvas.toBlob(blob => { if (attempt !== generation.current) return; if (blob) choose(new File([blob], "face-capture.jpg", { type: "image/jpeg" })); else setError("Capture failed. Try again."); }, "image/jpeg", .9);
  }
  return <section className="face-capture" aria-label={login ? "Student face login" : "Face identification"}><h2>{login ? "Sign in with your face" : "Identify by face"}</h2><p>{login ? "Face the camera alone, capture a photo, then sign in using your approved enrollment photo." : "Frame one student, capture a photo, then check the returned details."}</p>
    {login && <p className="help-note">Demo feature: photos can fool this matcher. It does not check liveness. Choose password login if you prefer.</p>}
    <div className="camera-frame"><video ref={video} autoPlay playsInline muted hidden={!camera} aria-label="Live camera preview" />{preview && <img src={preview} alt={login ? "Photo captured for sign-in" : "Photo selected for identification"} />}{!camera && !preview && <div><span aria-hidden="true">◎</span><p>Camera opens only when you choose.</p></div>}</div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="camera-actions">{camera ? <><button type="button" className="primary-button" disabled={busy} onClick={capture}>Capture photo</button><button type="button" className="secondary-button" disabled={busy} onClick={stop}>Stop camera</button></> : <button type="button" className="secondary-button" disabled={busy || starting} onClick={() => void start()}>{starting ? "Opening camera…" : "Open camera"}</button>}{starting && <button type="button" className="secondary-button" onClick={stop}>Cancel camera</button>}</div>
    {!login && <label className="field"><span id="face-photo-label">Use a face photo</span><input aria-labelledby="face-photo-label" aria-describedby="face-photo-hint" type="file" accept="image/jpeg,image/png" disabled={busy} onChange={event => { choose(event.target.files?.[0] ?? null); event.target.value = ""; }} /><small id="face-photo-hint">JPEG or PNG · up to 5 MB. Photos are not saved in the browser’s order history.</small></label>}
    {photo && <button type="button" className="primary-button" disabled={busy} onClick={() => identify(photo)}>{busy ? (login ? "Signing in…" : "Identifying…") : (login ? "Sign in with this photo" : "Identify student")}</button>}
  </section>;
}
