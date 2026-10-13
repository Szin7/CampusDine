"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useSession } from "@/components/SessionProvider";
export default function AdminLayout({ children }: { children: ReactNode }) {
  const { session, loading, error, refresh } = useSession();
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    if (loading || error) return;
    if (!session) router.replace("/sign-in");
    else if (session.role !== "admin") router.replace(session.role === "student" ? "/menu" : "/account");
  }, [session, loading, error, router]);
  if (error) return <main id="main" className="account-page"><div className="form-error" role="alert">{error}<button className="text-button" onClick={() => void refresh()}>Try again</button></div></main>;
  if (loading || session?.role !== "admin") return <main id="main" className="account-page"><p role="status">Checking administrator access…</p></main>;
  return <div className="admin-shell"><nav className="admin-navigation" aria-label="Admin navigation"><div><span className="admin-label">CANTEEN ADMIN</span><Link href="/admin/students" aria-current={path.startsWith("/admin/students") ? "page" : undefined}>Students</Link><Link href="/admin/menu" aria-current={path.startsWith("/admin/menu") ? "page" : undefined}>Menu</Link><Link href="/admin/accounts" aria-current={path.startsWith("/admin/accounts") ? "page" : undefined}>Accounts</Link><Link href="/admin/billing" aria-current={path.startsWith("/admin/billing") ? "page" : undefined}>Billing</Link><Link href="/admin/reports" aria-current={path.startsWith("/admin/reports") ? "page" : undefined}>Sales</Link></div><Link href="/account">{session.name} · My account</Link></nav>{children}</div>;
}
