// SPDX-License-Identifier: MIT

import type { Metadata } from "next";
import { PAGE_TITLES, PAGE_DESCRIPTIONS } from "@/lib/page-titles";

// Overrides the parent /batches layout metadata for the /batches/new route.
export const metadata: Metadata = {
  title: PAGE_TITLES.NEW_BATCH,
  description: PAGE_DESCRIPTIONS.NEW_BATCH,
};

export default function NewBatchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
