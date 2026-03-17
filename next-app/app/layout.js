import "./globals.css";

export const metadata = {
  title: {
    default: "EduVenture",
    template: "%s | EduVenture",
  },
  description: "Resilient Next.js launchpad for the EduVenture learning workspace.",
  applicationName: "EduVenture",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0e1528",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
