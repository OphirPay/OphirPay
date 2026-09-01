import { notFound } from "next/navigation";
import prisma from "@/lib/prisma";
import { formatAmount } from "@/lib/utils";
import { generatePaymentLink, generateStellarDeepLink } from "@/lib/payment-link";
import Link from "next/link";
import { CopyButton } from "@/components/ui/CopyButton";

export default async function PaymentRequestPage({ params }: { params: { id: string } }) {
  const req = await prisma.paymentRequest.findUnique({
    where: { id: params.id }
  });

  if (!req) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center px-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Request Not Found</h1>
        <p className="text-gray-500 dark:text-gray-400">This payment request does not exist or has been deleted.</p>
        <Link href="/" className="mt-6 text-ophir-600 hover:underline">Return to Home</Link>
      </div>
    );
  }

  const isExpired = req.dueDate && new Date(req.dueDate) < new Date();
  
  if (isExpired && req.status !== "PAID") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center px-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Request Expired</h1>
        <p className="text-gray-500 dark:text-gray-400">This payment request expired on {req.dueDate?.toLocaleString()}.</p>
        <Link href="/" className="mt-6 text-ophir-600 hover:underline">Return to Home</Link>
      </div>
    );
  }

  const payUrl = generatePaymentLink({
    destination: req.recipientAddress || "",
    amount: req.amount.toString(),
    assetCode: req.assetCode,
    memo: `req-${req.id.slice(0, 8)}`,
  });

  return (
    <div className="max-w-md mx-auto mt-12 px-4 animate-fade-in">
      <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 md:p-8 shadow-sm border border-gray-200 dark:border-gray-800 text-center">
        <div className="w-16 h-16 bg-blue-50 dark:bg-blue-900/30 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
          </svg>
        </div>
        
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
          {formatAmount(Number(req.amount), req.assetCode)}
        </h1>
        
        {req.description && (
          <p className="text-gray-500 dark:text-gray-400 mb-6">{req.description}</p>
        )}
        
        {req.dueDate && (
          <p className="text-sm text-gray-400 mb-6">Due by: {req.dueDate.toLocaleString()}</p>
        )}

        {req.status === "PAID" ? (
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-100 text-green-800 font-medium">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Already Paid
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <a href={payUrl} className="w-full px-4 py-3 rounded-xl bg-gradient-to-r from-ophir-600 to-stellar-dark text-white font-medium hover:from-ophir-700 hover:to-stellar transition-all shadow-md">
              Pay with Browser Wallet
            </a>
            <a href={generateStellarDeepLink({ destination: req.recipientAddress || "", amount: req.amount.toString(), assetCode: req.assetCode, memo: `req-${req.id.slice(0,8)}` })} className="w-full px-4 py-3 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
              Pay with Mobile App
            </a>
          </div>
        )}
      </div>
      <div className="mt-8 text-center text-sm text-gray-500">
        Powered by <Link href="/" className="font-semibold text-ophir-600 hover:underline">OphirPay</Link>
      </div>
    </div>
  );
}
