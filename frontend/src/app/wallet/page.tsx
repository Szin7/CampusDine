"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/SessionProvider";
import { StudentBalances } from "@/components/StudentBalances";
import { WalletHistory } from "@/components/WalletHistory";
import { CreditHistory } from "@/components/CreditHistory";
import { api, ApiError, rupees, type AccountSummary } from "@/lib/api";
export default function Wallet() {
  const { session, loading, error: sessionError, refresh, setSession } = useSession();
  const router = useRouter();
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const expired = useCallback(() => { setSession(null); router.replace("/sign-in"); }, [setSession, router]);
  useEffect(() => {
    if (loading || sessionError) return;
    if (!session) router.replace("/sign-in");
    else if (session.role !== "student") router.replace("/account");
  }, [session, loading, sessionError, router]);
  useEffect(() => {
    if (session?.role !== "student") return;
    const abort = new AbortController();
    setSummary(null); setError("");
    api<AccountSummary>("/wallet", { signal: abort.signal }).then(value => { if (!abort.signal.aborted) setSummary(value); }).catch(err => {
      if (abort.signal.aborted) return;
      if (err instanceof ApiError && [401, 403].includes(err.status)) expired();
      else setError((err as Error).message);
    });
    return () => abort.abort();
  }, [session, reload, expired]);
  if (loading || (!session && !sessionError) || (session && session.role !== "student")) return <main id="main" className="account-page"><p role="status">Opening your account…</p></main>;
  if (sessionError) return <main id="main" className="account-page"><div className="form-error" role="alert">{sessionError}<button className="text-button" onClick={() => void refresh()}>Try again</button><Link href="/sign-in">Back to sign in</Link></div></main>;
  return <main id="main" className="wallet-page"><StudentBalances student={summary} error={error} retry={() => setReload(value => value + 1)} active="/wallet" />
    <div className="wallet-heading"><div><p className="eyebrow">WALLET & CREDIT</p><h1>Every meal, accounted for.</h1><p>Your balance, purchases and payments in one place.</p></div>{summary && <p className="wallet-student">{summary.name}<span>{summary.roll_no}</span></p>}</div>
    <section className="wallet-overview" aria-label="Account totals"><div className="wallet-balance-panel"><span>Wallet balance</span><strong>{summary ? rupees(summary.wallet_balance) : error ? "Unavailable" : "Loading…"}</strong><p>Prepaid balance for canteen orders.</p></div><div className="credit-overview"><div><span>Outstanding dues</span><strong>{summary ? rupees(summary.credit_balance) : "—"}</strong></div><dl><div><dt>Credit limit</dt><dd>{summary ? rupees(summary.credit_limit) : "—"}</dd></div><div><dt>Available credit</dt><dd>{summary ? rupees(summary.remaining_credit) : "—"}</dd></div></dl><p>{summary?.credit_limit === 0 ? "Credit is not enabled for your account. You can still order using your wallet." : "If your wallet cannot cover an order, the full amount uses credit within your available limit."}</p></div></section>
    <div className="accounts-office-note"><strong>Top-ups & settlement</strong><p>Contact the college accounts office to top up your wallet or settle credit dues. A wallet top-up does not settle outstanding credit.</p></div>
    <WalletHistory key={`wallet-${session?.id}`} onSessionExpired={expired} />
    <CreditHistory key={`credit-${session?.id}`} onSessionExpired={expired} />
  </main>;
}
