import Script from "next/script";

export default function Page() {
  return (
    <>
      <div id="splash-screen">
        <div className="shape" />
        <div className="brand-text">Eduventure</div>
      </div>
      <Script src="/assets/UI.js" strategy="afterInteractive" />
      <Script src="/script.js" strategy="afterInteractive" />
      <Script src="/elements/UI.js" strategy="afterInteractive" />
      <Script src="/sw.js" strategy="afterInteractive" />
    </>
  );
}
