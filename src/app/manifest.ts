// SPDX-License-Identifier: MIT

import type { MetadataRoute } from "next";

/**
 * PWA manifest for installable web app experience.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OphirPay — Stellar Payment Orchestration",
    short_name: "OphirPay",
    description:
      "Open-source payment orchestration layer for Stellar. Send payments, manage batches, schedule recurring transfers, and track everything in real-time.",
    start_url: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0a0a1a",
    theme_color: "#7B68EE",
    categories: ["finance", "productivity", "utilities"],
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
    screenshots: [
      {
        src: "/screenshots/dashboard.png",
        sizes: "2880x1800",
        type: "image/png",
        form_factor: "wide",
        label: "OphirPay Dashboard and Real-Time Stellar Metrics",
      },
      {
        src: "/screenshots/mobile-responsive.png",
        sizes: "780x1688",
        type: "image/png",
        form_factor: "narrow",
        label: "Mobile-Responsive Payment Orchestration and Tracking",
      },
      {
        src: "/screenshots/payments.png",
        sizes: "2880x1800",
        type: "image/png",
        form_factor: "wide",
        label: "Batch and Payment Management on Stellar",
      },
    ],
    shortcuts: [
      {
        name: "Send Payment",
        short_name: "Send",
        description: "Send a Stellar payment",
        url: "/send",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Dashboard",
        short_name: "Dashboard",
        description: "View your payment dashboard",
        url: "/",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
