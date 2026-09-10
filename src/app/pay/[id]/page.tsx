import { redirect } from "next/navigation";
import prisma from "@/lib/prisma";
import { isValidStellarAddress } from "@/lib/stellar";
import { PaymentRequestClient } from "./PaymentRequestClient";

interface PayPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ amount?: string; memo?: string; asset?: string }>;
}

export default async function PayPage({ params, searchParams }: PayPageProps) {
  const { id } = await params;
  const { amount, memo, asset } = await searchParams;

  // 1. Backward compatibility: if `id` is actually a stellar address, redirect to /send
  if (isValidStellarAddress(id)) {
    const search = new URLSearchParams();
    search.set("dest", id);
    if (amount) search.set("amount", amount);
    if (memo) search.set("memo", memo);
    if (asset) search.set("asset", asset);
    redirect(`/send?${search.toString()}`);
  }

  // 2. Fetch the PaymentRequest
  const req = await prisma.paymentRequest.findUnique({
    where: { id },
  });

  if (!req) {
    return <ErrorState title="Invalid Payment Link" message="This payment request does not exist or the link is broken." />;
  }

  if (req.status === "PAID") {
    return <ErrorState title="Already Paid" message="This payment request has already been paid." isSuccess />;
  }

  if (req.status === "CANCELLED") {
    return <ErrorState title="Request Cancelled" message="This payment request was cancelled by the requester." />;
  }

  if (req.status === "EXPIRED" || (req.expiresAt && req.expiresAt < new Date())) {
    return <ErrorState title="Request Expired" message="This payment request has expired." />;
  }

  // Passing the serialized request to the client component
  return <PaymentRequestClient request={JSON.parse(JSON.stringify(req))} />;
}

function ErrorState({ title, message, isSuccess = false }: { title: string, message: string, isSuccess?: boolean }) {
  return (
    <div className="max-w-lg mx-auto mt-12 animate-fade-in p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 p-8 text-center">
        <div className={`h-16 w-16 mx-auto rounded-full flex items-center justify-center mb-4 ${isSuccess ? 'bg-green-100 dark:bg-green-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>
          {isSuccess ? (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8 text-green-600 dark:text-green-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-8 h-8 text-red-600 dark:text-red-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          )}
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-1">
          {title}
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6 max-w-sm mx-auto">
          {message}
        </p>
      </div>
    </div>
  );
}
