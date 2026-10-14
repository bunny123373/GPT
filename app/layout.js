import { Inter } from "next/font/google";
import Script from "next/script";
import { BOOT_SCRIPT } from "../lib/theme";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
});

export const metadata = {
  title: "GPT — AI Chat & Images",
  description:
    "A private AI assistant for writing, answering questions, coding and creating images.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon-180.png", sizes: "180x180" }],
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Both are declared with media queries so the browser chrome matches the
  // theme actually in use rather than always claiming the dark one.
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#1f1e1d" },
    { media: "(prefers-color-scheme: light)", color: "#faf9f5" },
  ],
};

export default function RootLayout({ children }) {
  return (
    /* data-theme is set by the inline script below before first paint. The
       attribute here is only the server-rendered fallback. */
    <html lang="en" data-theme="night" className={inter.variable}>
      <head>
        {/* Must run before the body paints, or a light-mode user gets a dark
            flash. Deliberately inline and blocking rather than a <Script>. */}
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      <body className="h-full antialiased">
        {/* Puter.js must be on the page before any client component uses it. */}
        <Script src="https://js.puter.com/v2/" strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  );
}