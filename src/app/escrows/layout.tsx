// SPDX-License-Identifier: MIT

import type { Metadata } from "next";
import { PAGE_TITLES, PAGE_DESCRIPTIONS } from "@/lib/page-titles";

export const metadata: Metadata = {
  title: PAGE_TITLES.ESCROWS,
  description: PAGE_DESCRIPTIONS.ESCROWS,
};

export default function EscrowsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
