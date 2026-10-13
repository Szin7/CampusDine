import { rupees, type MenuItem, type Recommendations as RecommendationData, type RecommendationSource } from "@/lib/api";
const labels: Record<RecommendationSource, string> = { usual: "Your usual", collaborative: "Based on your past orders", popular: "Popular this week", menu: "On the menu" };
const headings: Record<RecommendationSource, [string, string]> = {
  usual: ["Your usuals", "The dishes you come back to most often."],
  collaborative: ["Something to try", "Suggestions based on dishes ordered together at the canteen."],
  popular: ["Most ordered this week", "A look at what’s been going across the counter."],
  menu: ["From the canteen", "A few available dishes to start with."],
};
export function Recommendations({ data, menu }: { data: RecommendationData; menu: MenuItem[] }) {
  const current = new Map(menu.map(item => [item.id, item]));
  // The menu and recommendation reads can straddle an availability change. Prefer the menu snapshot.
  const choices = data.items.flatMap(({ item, source }) => {
    const latest = current.get(item.id);
    return latest?.is_available && !latest.is_archived ? [{ item: latest, source }] : [];
  });
  if (!choices.length) return null;
  const [heading, description] = headings[choices[0].source];
  return <section className="recommendation-section" aria-labelledby="recommendation-title"><div className="recommendation-intro"><p className="eyebrow">A LITTLE HELP CHOOSING</p><h2 id="recommendation-title">{heading}</h2><p>{description}</p><span className="recommendation-rule" aria-hidden="true" /></div>
    <ul className="recommendation-list">{choices.slice(0, 4).map(({ item, source }, index) => <li key={item.id}><span className="recommendation-number" aria-hidden="true">0{index + 1}</span><div><small>{labels[source]}</small><h3>{item.name}</h3><p>{item.category}</p></div><strong>{rupees(item.price)}</strong></li>)}</ul>
  </section>;
}
