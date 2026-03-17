"use client";

export default function Error({ reset }) {
  return (
    <main className="launcher-empty-state">
      <section className="state-panel">
        <h1>Launch shell hit an error</h1>
        <p>
          The Next.js wrapper failed before handing off to the main workspace. You can retry from
          here or open the legacy home directly.
        </p>
        <div className="launcher-actions" style={{ justifyContent: "center", marginTop: "1.4rem" }}>
          <button className="launcher-button" type="button" onClick={() => reset()}>
            Retry launcher
          </button>
          <a className="launcher-link-button" href="/pages/home/home%20page.html">
            Open legacy home
          </a>
        </div>
      </section>
    </main>
  );
}
