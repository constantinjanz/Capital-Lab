export default function Loading() {
  return (
    <main className="loading-screen" aria-label="Loading Capital Lab">
      <div className="loading-screen__brand">
        <span className="skeleton skeleton--mark" />
        <span className="skeleton skeleton--title" />
      </div>
      <div className="loading-screen__grid">
        {Array.from({ length: 8 }, (_, index) => (
          <span className="skeleton skeleton--card" key={index} />
        ))}
      </div>
      <span className="sr-only">Loading research state…</span>
    </main>
  )
}
