// SPDX-License-Identifier: MIT

import type { Metadata } from "next";
import { PAGE_TITLES, PAGE_DESCRIPTIONS } from "@/lib/page-titles";

export const metadata: Metadata = {
  title: PAGE_TITLES.RECEIVE,
  description: PAGE_DESCRIPTIONS.RECEIVE,
};

export default function ReceiveLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
