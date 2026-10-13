"use client";
import { useEffect, useState } from "react";
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.dataset.theme === "dark"); }, []);
  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try { localStorage.setItem("campusdine-theme", next ? "dark" : "light"); } catch { /* Private browsing can disable storage. */ }
  }
  return <button className="theme-toggle" type="button" onClick={toggle} aria-label={dark ? "Use light theme" : "Use dark theme"}>{dark ? "Light mode" : "Dark mode"}</button>;
}
