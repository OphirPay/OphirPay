// SPDX-License-Identifier: MIT

import PaymentDetailView from "./PaymentDetailView";

export default async function PaymentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PaymentDetailView id={id} />;
}
