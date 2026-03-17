export default function NotFound() {
  return (
    <main className="launcher-empty-state">
      <section className="state-panel">
        <h1>Page not found</h1>
        <p>This Next.js route does not exist. You can jump back into the main EduVenture workspace.</p>
        <div className="launcher-actions" style={{ justifyContent: "center", marginTop: "1.4rem" }}>
          <a className="launcher-button" href="/pages/home/home%20page.html">
            Open EduVenture home
          </a>
        </div>
      </section>
    </main>
  );
}
