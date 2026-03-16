export const metadata = {
  title: "EduVenture | Welcome",
  icons: {
    icon: "/favicon.png"
  }
};

export const viewport = {
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
