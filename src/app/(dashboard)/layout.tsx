// SPDX-License-Identifier: MIT

import type { Metadata } from "next";
import { PAGE_TITLES, PAGE_DESCRIPTIONS } from "@/lib/page-titles";

// Server-rendered metadata for the home route `/` (route group, so the URL
// is unchanged). Without this, crawlers, link previews, and JS-disabled
// clients would get the generic root-layout fallback on the landing page.
// usePageTitle() in the client page keeps the browser tab in sync during
// client-side navigation.
export const metadata: Metadata = {
  title: PAGE_TITLES.HOME,
  description: PAGE_DESCRIPTIONS.HOME,
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
