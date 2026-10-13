"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/SessionProvider";
import { StudentBalances } from "@/components/StudentBalances";
import { MenuCard } from "@/components/MenuCard";
import { Basket } from "@/components/Basket";
import { useBasket } from "@/lib/useBasket";
import { Recommendations } from "@/components/Recommendations";
import { api, ApiError, readMenu, rupees, type Student, type MenuItem, type Recommendations as RecommendationData } from "@/lib/api";

export default function Menu() {
  const { session, loading: sessionLoading, error: sessionError, refresh, setSession } = useSession();
  const router = useRouter();
  const [student, setStudent] = useState<Student | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [recommendations, setRecommendations] = useState<RecommendationData>({ items: [] });
  const [loading, setLoading] = useState(true);
  const [menuError, setMenuError] = useState("");
  const [balanceError, setBalanceError] = useState("");
  const [recommendationError, setRecommendationError] = useState(false);
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [availableOnly, setAvailableOnly] = useState(false);
  useEffect(() => {
    if (sessionLoading || sessionError) return;
    if (!session) router.replace("/sign-in");
    else if (session.role !== "student") router.replace("/account");
  }, [session, sessionLoading, sessionError, router]);
  useEffect(() => {
    if (session?.role !== "student") return;
    const abort = new AbortController();
    setLoading(true); setMenuError(""); setBalanceError(""); setRecommendationError(false);
    setMenu([]); setStudent(null); setRecommendations({ items: [] });
    Promise.allSettled([
      api<Student>("/students/me", { signal: abort.signal }),
      readMenu(abort.signal),
      api<RecommendationData>("/menu/recommendations?limit=4", { signal: abort.signal }),
    ]).then(([profile, dishes, suggestions]) => {
      if (abort.signal.aborted) return;
      const unauthorized = [profile, dishes, suggestions].some(result => result.status === "rejected" && result.reason instanceof ApiError && [401, 403].includes(result.reason.status));
      if (unauthorized) { setSession(null); router.replace("/sign-in"); return; }
      if (profile.status === "fulfilled") setStudent(profile.value); else setBalanceError(profile.reason.message);
      if (dishes.status === "fulfilled") setMenu(dishes.value); else setMenuError(dishes.reason.message);
      if (suggestions.status === "fulfilled") setRecommendations(suggestions.value); else setRecommendationError(true);
      setLoading(false);
    });
    return () => abort.abort();
  }, [session, reload, router, setSession]);
  const basket = useBasket(session, menu, () => setReload(value => value + 1), () => setReload(value => value + 1), () => { setSession(null); router.replace("/sign-in"); });
  const categories = useMemo(() => {
    const names = new Map<string, string>();
    for (const item of menu) names.set(item.category.toLocaleLowerCase(), item.category);
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [menu]);
  const visible = menu.filter(item => (!category || item.category.toLocaleLowerCase() === category)
    && (!availableOnly || item.is_available)
    && `${item.name} ${item.category}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  function clearFilters() { setQuery(""); setCategory(""); setAvailableOnly(false); }
  function retry() { setReload(value => value + 1); }
  if (sessionLoading || (!session && !sessionError) || (session && session.role !== "student")) return <main id="main" className="account-page"><p role="status">Opening your canteen…</p></main>;
  if (sessionError) return <main id="main" className="account-page"><div className="form-error" role="alert">{sessionError}<button className="text-button" onClick={() => void refresh()}>Try again</button><Link href="/sign-in">Back to sign in</Link></div></main>;
  return <main id="main" className="menu-page"><StudentBalances student={student} error={balanceError} retry={retry} />
    <div className="menu-heading"><div><p className="eyebrow">NATIONAL COLLEGE OF ENGINEERING / CANTEEN</p><h1>What sounds good?</h1><p>Find your lunch. Or just your next cup of tea.</p></div><div className="menu-heading-note"><span>YOUR CAMPUS BREAK</span><p>Familiar food.<br /><em>A little time for yourself.</em></p></div></div>
    <div className="ordering-layout"><div className="menu-content">{loading ? <p className="menu-loading" role="status">Loading the canteen menu…</p> : menuError ? <div className="form-error" role="alert">{menuError}<button className="text-button" onClick={retry}>Try loading the menu again</button></div> : <>
      <Recommendations data={recommendations} menu={menu} />
      {recommendationError && <p className="recommendation-unavailable" role="status">Suggestions aren’t available right now. You can still browse the full menu.</p>}
      <section className="full-menu" aria-labelledby="full-menu-title"><div className="menu-controls-heading"><h2 id="full-menu-title">The menu</h2><label className="menu-search"><span className="sr-only">Search menu</span><input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find momo, tea, lunch…" /></label></div>
        {menu.length > 0 && <><div className="menu-filters"><div className="category-filters" aria-label="Menu categories"><button aria-pressed={!category} onClick={() => setCategory("")}>Everything</button>{categories.map(([key, name]) => <button key={key} aria-pressed={category === key} onClick={() => setCategory(key)}>{name}</button>)}</div><label className="availability-filter"><input type="checkbox" checked={availableOnly} onChange={e => setAvailableOnly(e.target.checked)} />Available only</label></div><p className="menu-result-count" role="status">{visible.length} {visible.length === 1 ? "item" : "items"}{category ? ` in ${categories.find(([key]) => key === category)?.[1] ?? category}` : " on the menu"}</p></>}
        {visible.length > 0 ? <div className="menu-grid">{visible.map(item => <MenuCard key={item.id} item={item} disabled={basket.locked || (basket.lines.find(line => line.item.id === item.id)?.quantity ?? 0) >= 50 || (!basket.lines.some(line => line.item.id === item.id) && basket.lines.length >= 50)} onAdd={() => basket.change(item, 1)} />)}</div> : <div className="menu-empty"><h3>{menu.length ? "Nothing matches just yet." : "The menu is being prepared."}</h3><p>{menu.length ? "Try a different name or category." : "Check with the canteen counter for today’s available dishes."}</p>{menu.length > 0 && <button className="secondary-button" onClick={clearFilters}>Clear filters</button>}</div>}
      </section>
    </>}
    </div><Basket basket={basket} student={student} /></div>
    {basket.lines.length > 0 && <a className="mobile-basket-link" href="#basket">Review basket · {basket.lines.reduce((sum, line) => sum + line.quantity, 0)} items <span>{rupees(basket.total)}</span></a>}
    <div className="menu-counter-note"><strong>At the counter</strong><p>Staff can identify you by face, or look you up using your roll number. Wallet and credit details are in <Link href="/account">your account</Link>.</p></div>
  </main>;
}
