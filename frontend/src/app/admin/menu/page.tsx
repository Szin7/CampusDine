"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, rupees, type MenuItem } from "@/lib/api";
import { useSession } from "@/components/SessionProvider";
import { MenuItemEditor } from "@/components/MenuItemEditor";

export default function AdminMenu() {
  const { session, setSession } = useSession();
  const router = useRouter();
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const [filter, setFilter] = useState("current");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<MenuItem | "new" | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const writing = useRef(false);
  const expired = useCallback(() => { setSession(null); router.replace("/sign-in"); }, [setSession, router]);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true); setError("");
    async function load() {
      const found = new Map<number, MenuItem>();
      for (let offset = 0; ; offset += 200) {
        const page = await api<MenuItem[]>(`/admin/menu?include_archived=true&limit=200&offset=${offset}`, { signal: abort.signal });
        if (abort.signal.aborted) return;
        for (const item of page) found.set(item.id, item);
        if (page.length < 200) break;
      }
      setItems([...found.values()]);
    }
    load().catch(err => {
      if (abort.signal.aborted) return;
      if (err instanceof ApiError && [401, 403].includes(err.status)) expired(); else setError((err as Error).message);
    }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [reload, expired]);
  async function toggle(item: MenuItem) {
    if (!session || writing.current) return;
    writing.current = true; setBusyId(item.id); setNotice(""); setError("");
    try {
      const updated = await api<MenuItem>(`/admin/menu/${item.id}`, { method: "PATCH", body: JSON.stringify({ is_available: !item.is_available }) }, session.csrf_token);
      setItems(current => current.map(row => row.id === updated.id ? updated : row));
      setNotice(`${updated.name} is now ${updated.is_available ? "available" : "sold out"}.`);
    } catch (err) {
      if (err instanceof ApiError && [401, 403].includes(err.status)) expired();
      else setError(`${(err as Error).message} Reload the menu to check its current state.`);
    } finally { writing.current = false; setBusyId(null); }
  }
  const rows = items.filter(item => (filter === "archived" ? item.is_archived : !item.is_archived) && `${item.name} ${item.category}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <main id="main" className="admin-students">
    <div className="admin-page-heading"><div><p className="eyebrow">KITCHEN & PRICES</p><h1>Menu</h1><p>Keep today’s dishes, prices and availability up to date.</p></div><button className="primary-button" disabled={loading || !!error || busyId !== null} onClick={() => setEditor("new")}>Add a dish</button></div>
    <div className="student-filters"><label className="field menu-search"><span>Find a dish</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Dish name or category" /></label><div className="category-filters" aria-label="Menu records"><button aria-pressed={filter === "current"} onClick={() => setFilter("current")}>Current menu</button><button aria-pressed={filter === "archived"} onClick={() => setFilter("archived")}>Archived dishes</button></div><button className="secondary-button" disabled={loading || busyId !== null} onClick={() => setReload(value => value + 1)}>Reload menu</button></div>
    {notice && <p className="admin-success" role="status">{notice}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {loading ? <p className="history-message" role="status">Loading menu…</p> : !error && (rows.length ? <div className="history-table-wrap"><table className="history-table admin-menu-table"><caption className="sr-only">Canteen menu management</caption><thead><tr><th scope="col">Dish</th><th scope="col">Category</th><th scope="col">Price</th><th scope="col">Availability</th><th scope="col">Action</th></tr></thead><tbody>{rows.map(item => <tr key={item.id}><th scope="row" data-label="Dish">{item.name}</th><td data-label="Category">{item.category}</td><td data-label="Price">{rupees(item.price)}</td><td data-label="Availability">{item.is_archived ? <span>Archived</span> : <button className={`availability-switch ${item.is_available ? "available" : ""}`} role="switch" aria-checked={item.is_available} aria-label={`Available: ${item.name}`} disabled={busyId !== null} onClick={() => void toggle(item)}>{busyId === item.id ? "Saving…" : item.is_available ? "Available" : "Sold out"}</button>}</td><td data-label="Action"><button className="review-student-button" aria-label={`Edit ${item.name}`} disabled={busyId !== null} onClick={() => setEditor(item)}>Edit dish →</button></td></tr>)}</tbody></table></div> : <div className="history-message"><h2>{query ? "No dishes match your search." : filter === "archived" ? "No archived dishes." : "The menu is empty."}</h2><p>{query ? "Try a dish name or category." : "Add dishes as the kitchen confirms what it will serve."}</p></div>)}
    <p className="history-footnote">Sold-out dishes stay visible to students but cannot be ordered. Archived dishes leave the menu; their order history remains.</p>
    {editor !== null && <MenuItemEditor item={editor === "new" ? null : editor} categories={[...new Set(items.map(item => item.category))].sort()} close={() => { setEditor(null); setReload(value => value + 1); }} expired={expired} saved={item => { setEditor(null); setNotice(`${item.name} saved.`); setReload(value => value + 1); }} />}
  </main>;
}
