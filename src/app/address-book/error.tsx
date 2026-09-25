"use client";
// SPDX-License-Identifier: MIT

import { SegmentError } from "@/components/SegmentError";

export default function AddressBookError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SegmentError
      segment="address-book"
      title="Address Book"
      error={error}
      reset={reset}
    />
  );
}
