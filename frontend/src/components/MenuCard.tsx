import { rupees, type MenuItem } from "@/lib/api";
export function MenuCard({ item, onAdd, disabled }: { item: MenuItem; onAdd: () => void; disabled: boolean }) {
  return <article className={`menu-card${item.is_available ? "" : " sold-out"}`} aria-labelledby={`item-${item.id}`}>
    <div className="menu-card-top"><span className="menu-category">{item.category}</span><span className={`availability${item.is_available ? "" : " unavailable"}`}>{item.is_available ? "Available" : "Sold out"}</span></div>
    <h3 id={`item-${item.id}`}>{item.name}</h3>
    <div className="menu-card-bottom"><strong>{rupees(item.price)}</strong>{item.is_available ? <button className="add-to-basket" disabled={disabled} onClick={onAdd} aria-label={`Add ${item.name} to basket`}>Add +</button> : <span>Currently unavailable</span>}</div>
  </article>;
}
