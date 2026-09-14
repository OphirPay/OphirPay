// SPDX-License-Identifier: MIT

import type { Metadata } from "next";
import { PAGE_TITLES, PAGE_DESCRIPTIONS } from "@/lib/page-titles";

// Server-rendered metadata for this route — crawlers, link previews, and
// JS-disabled clients get the route-specific title/description instead of
// the generic layout default. usePageTitle() in the client page keeps the
// browser tab in sync during client-side navigation.
export const metadata: Metadata = {
  title: {
    default: PAGE_TITLES.PAYMENTS,
    template: "%s | OphirPay",
  },
  description: PAGE_DESCRIPTIONS.PAYMENTS,
};

export default function PaymentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
