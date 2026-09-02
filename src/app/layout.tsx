// SPDX-License-Identifier: MIT

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./mobile-ux.css";
import { AppShell } from "@/components/AppShell";

export { reportWebVitals } from "@/lib/web-vitals";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "OphirPay — Stellar Payment Orchestration",
    template: "%s | OphirPay",
  },
  description:
    "OphirPay is a Stellar-native payment orchestration platform for individuals, businesses, nonprofits, and DAOs.",
  icons: { icon: "/icon.svg" },
  manifest: "/manifest.json",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://ophirpay.vercel.app"),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "OphirPay — Stellar Payment Orchestration",
    description: "Open-source payment orchestration layer for Stellar. Send, batch, schedule, and track payments.",
    type: "website",
    siteName: "OphirPay",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "OphirPay — Stellar Payment Orchestration" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "OphirPay — Stellar Payment Orchestration",
    description: "Open-source payment orchestration layer for Stellar. Smart contracts, webhooks, batch payments, refunds, multisig, governance.",
    images: ["/og-image.png"],
  },
  robots: { index: true, follow: true },
  colorScheme: "dark light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Blocking theme script — applies the saved theme class before the
            first paint to prevent a flash of the wrong theme (FOUC). Must stay
            in sync with resolveTheme() in src/hooks/useTheme.tsx. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                try {
                  var stored = localStorage.getItem("ophirpay-theme");
                  var dark = stored === "dark" ||
                    ((stored === null || stored === "system") &&
                      window.matchMedia("(prefers-color-scheme: dark)").matches);
                  if (dark) document.documentElement.classList.add("dark");
                  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
                } catch (e) {}
              })();
            `,
          }}
        />
        {/* JSON-LD structured data for SEO */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: "OphirPay",
              url: process.env.NEXT_PUBLIC_APP_URL || "https://ophirpay.vercel.app",
              description: "Open-source payment orchestration layer for Stellar — smart contracts, webhooks, batch payments, refunds, multisig, and governance.",
              applicationCategory: "FinanceApplication",
              operatingSystem: "All",
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
              },
            }),
          }}
        />
        {/* Register service worker for PWA offline support */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                  navigator.serviceWorker.register('/sw.js').then(
                    (reg) => console.log('[SW] Registered:', reg?.scope || ''),
                    (err) => console.warn('[SW] Registration failed:', err)
                  );
                });
              }
            `,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100`}
      >
        {/* Skip-to-content link for keyboard users */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-ophir-600 focus:text-white focus:rounded-lg focus:outline-none"
        >
          Skip to main content
        </a>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
