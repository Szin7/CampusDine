export function AuthAside() {
  return <aside className="auth-aside">
    <p className="eyebrow">THE CAMPUS CANTEEN</p>
    <h1>A proper break.<br /><em>Less waiting.</em></h1>
    <p className="aside-intro">From the first cup of tea to lunch between lectures. Your canteen, a little closer.</p>
    <div className="canteen-drawing" aria-hidden="true"><svg viewBox="0 0 520 260" fill="none">
      <path d="M42 199h431l-22 32H64z" stroke="currentColor" strokeWidth="2"/>
      <ellipse cx="211" cy="153" rx="116" ry="33" stroke="currentColor" strokeWidth="2"/>
      <path d="M99 153c12 38 208 38 224 0M128 149c-8-26 28-42 35-5m-8 8c-8-25 24-43 34-9m3 7c-5-34 28-45 36-8m-3 9c-2-28 31-41 36-7m-2 10c3-22 34-27 35-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <path d="M360 97h61l-5 76c-4 18-45 18-50 0zM420 111c40-10 39 47-2 44M374 73c-12-18 12-22 0-40m21 40c-12-18 12-22 0-40" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      <path d="M78 71h85m-85 8h61M302 214h83" stroke="currentColor" opacity=".4"/>
    </svg></div>
    <div className="aside-bottom"><span>One college.<br />One familiar counter.</span><span>TEA / MOMO / LUNCH</span></div>
  </aside>;
}
