import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hollow House Escape",
  description: "A kid-friendly Halloween escape room: find the town's vanished candy through ghost, witch and zombie rooms.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#221a3b" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Grandstander:wght@500;700;800&family=Lexend:wght@400;500;600&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
