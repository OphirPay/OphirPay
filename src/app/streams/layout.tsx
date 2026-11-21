// SPDX-License-Identifier: MIT

import type { Metadata } from "next";

import { PAGE_DESCRIPTIONS,PAGE_TITLES } from "@/lib/page-titles";

export const metadata: Metadata = {
  title: PAGE_TITLES.STREAMS,
  description: PAGE_DESCRIPTIONS.STREAMS,
};

export default function StreamsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
