"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useSession } from "@/components/SessionProvider";
export default function StaffLayout({ children }: { children: ReactNode }) {
  const { session, loading, error, refresh } = useSession();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => { if (loading || error) return; if (!session) router.replace("/sign-in"); else if (session.role !== "staff") router.replace(session.role === "student" ? "/menu" : "/admin/students"); }, [session, loading, error, router]);
  if (error) return <main id="main" className="account-page"><div role="alert" className="form-error">{error}<button className="text-button" onClick={() => void refresh()}>Try again</button></div></main>;
  if (loading || session?.role !== "staff") return <main id="main" className="account-page"><p role="status">Checking staff access…</p></main>;
  return <div className="admin-shell"><nav className="admin-navigation" aria-label="Staff navigation"><div><span className="admin-label">CANTEEN STAFF</span><Link href="/staff/counter" aria-current={path === "/staff/counter" ? "page" : undefined}>Counter</Link><Link href="/staff/queue" aria-current={path === "/staff/queue" ? "page" : undefined}>Order queue</Link></div><Link href="/account">{session.name} · My account</Link></nav>{children}</div>;
}
