"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError, type MenuItem } from "@/lib/api";
import { useSession } from "./SessionProvider";

export function MenuItemEditor({ item, categories, close, saved, expired }: {
  item: MenuItem | null; categories: string[]; close: () => void;
  saved: (item: MenuItem) => void; expired: () => void;
}) {
  const { session } = useSession();
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  async function write(body: object) {
    if (!session || submitting.current || uncertain) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      saved(await api<MenuItem>(item ? `/admin/menu/${item.id}` : "/admin/menu", {
        method: item ? "PATCH" : "POST", body: JSON.stringify(body),
      }, session.csrf_token));
    } catch (err) {
      if (err instanceof ApiError && [401, 403].includes(err.status)) expired();
      else if (!(err instanceof ApiError) || err.status === 0 || err.status >= 500) {
        // A lost create response can still mean the dish was added. I make the admin check first.
        setUncertain(true);
        setError("The result could not be confirmed. Close this form and reload the menu to check whether your change was saved before trying again.");
      } else setError(err.message);
    } finally { submitting.current = false; setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const priceText = String(data.get("price")).trim();
    if (!/^\d+(\.\d{1,2})?$/.test(priceText)) { setError("Enter a price with at most two decimal places."); return; }
    const [whole, fraction = ""] = priceText.split(".");
    const price = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    if (!Number.isSafeInteger(price) || price < 1 || price > 2147483647) { setError("Price must be between NPR 0.01 and NPR 21,474,836.47."); return; }
    const values = { name: String(data.get("name")).trim(), category: String(data.get("category")).trim(), price };
    if (!values.name || !values.category) { setError("Enter a dish name and category."); return; }
    const body = item ? Object.fromEntries(Object.entries(values).filter(([field, value]) => value !== item[field as keyof typeof values])) : { ...values, is_available: data.get("available") === "on" };
    if (!Object.keys(body).length) { close(); return; }
    void write(body);
  }
  return <dialog ref={dialog} className="student-dialog" aria-labelledby="menu-editor-title" onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <div className="dialog-heading"><div><p className="eyebrow">CANTEEN MENU</p><h2 id="menu-editor-title">{item ? "Edit dish" : "Add a dish"}</h2></div><button className="secondary-button" onClick={close} disabled={busy}>Close</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <form onSubmit={submit}><fieldset className="form-fields" disabled={busy || uncertain || confirmArchive}>
      <label className="field"><span>Dish name</span><input name="name" required maxLength={120} defaultValue={item?.name ?? ""} autoFocus /></label>
      <label className="field"><span>Category</span><input name="category" required maxLength={50} list="menu-categories" defaultValue={item?.category ?? ""} placeholder="Momo, Lunch, Drinks…" /></label>
      <datalist id="menu-categories">{categories.map(category => <option key={category} value={category} />)}</datalist>
      <label className="field"><span>Price (NPR)</span><input name="price" inputMode="decimal" required defaultValue={item ? (item.price / 100).toFixed(2) : ""} placeholder="120.00" /></label>
      {!item && <label className="menu-checkbox"><input type="checkbox" name="available" defaultChecked /> Available to order immediately</label>}
      <p className="history-footnote">Price changes apply to new orders. Existing orders keep their original price.</p>
      <button type="submit" className="primary-button">{busy ? "Saving…" : item ? "Save dish" : "Add dish"}</button>
    </fieldset></form>
    {item && <section className="menu-archive"><h3>{item.is_archived ? "Archived dish" : "Remove from the menu"}</h3><p>{item.is_archived ? "Restore this dish to the menu as sold out, then mark it available when the kitchen is ready." : "Archive a dish you no longer serve. Past orders and sales records stay intact."}</p>
      {confirmArchive ? <div className="action-confirmation"><p>Archive <strong>{item.name}</strong>? Students will no longer see it on the menu.</p><div><button className="primary-button" disabled={busy || uncertain} onClick={() => void write({ is_archived: true })}>Confirm archive</button><button className="secondary-button" disabled={busy} onClick={() => setConfirmArchive(false)}>Cancel</button></div></div>
        : <button className="secondary-button" disabled={busy || uncertain} onClick={() => item.is_archived ? void write({ is_archived: false, is_available: false }) : setConfirmArchive(true)}>{item.is_archived ? "Restore as sold out" : "Archive dish"}</button>}
    </section>}
  </dialog>;
}
