export function HistoryPagination({ page, hasMore, loading, onPage }: { page: number; hasMore: boolean; loading: boolean; onPage: (page: number) => void }) {
  if (page === 0 && !hasMore) return null;
  return <nav className="history-pagination" aria-label="History pages"><button className="secondary-button" disabled={page === 0 || loading} onClick={() => onPage(page - 1)}>Previous</button><span>Page {page + 1}</span><button className="secondary-button" disabled={!hasMore || loading} onClick={() => onPage(page + 1)}>Next</button></nav>;
}
