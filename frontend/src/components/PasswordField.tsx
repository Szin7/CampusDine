"use client";
import { useState } from "react";
export function PasswordField({ enrollment = false }: { enrollment?: boolean }) {
  const [visible, setVisible] = useState(false);
  return <div className="field"><label htmlFor="password">Password</label><span className="password-input">
    <input id="password" name="password" type={visible ? "text" : "password"} required minLength={enrollment ? 12 : 1} maxLength={128} autoComplete={enrollment ? "new-password" : "current-password"} aria-describedby={enrollment ? "password-hint" : undefined} />
    <button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? "Hide password" : "Show password"}>{visible ? "Hide" : "Show"}</button>
  </span>{enrollment && <small id="password-hint">Use at least 12 characters. A few memorable words work well.</small>}</div>;
}
