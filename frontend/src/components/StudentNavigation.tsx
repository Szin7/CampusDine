import Link from "next/link";
export type StudentPage = "/menu" | "/orders" | "/wallet";
export function StudentNavigation({ active }: { active: StudentPage }) {
  return <nav aria-label="Student navigation">{[["/menu", "Menu"], ["/orders", "My orders"], ["/wallet", "Wallet & credit"], ["/account", "My account"]].map(([href, label]) => <Link href={href} key={href} aria-current={active === href ? "page" : undefined}>{label}</Link>)}</nav>;
}
