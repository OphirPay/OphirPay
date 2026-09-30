// SPDX-License-Identifier: MIT

export function PayHandoff({
  paymentUri,
  sendHref,
}: {
  paymentUri: string;
  sendHref: string;
}) {
  return (
    <div className="mt-6 flex flex-col gap-3">
      <a
        href={paymentUri}
        className="text-center px-5 py-3 rounded-lg bg-ophir-600 text-white text-sm font-semibold hover:bg-ophir-700"
      >
        Open in Stellar wallet
      </a>
      <p className="text-center text-xs text-gray-500 dark:text-gray-400">
        On mobile, this opens a SEP-7 compatible wallet app.
      </p>
      <a
        href={sendHref}
        className="text-center px-5 py-3 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-800"
      >
        Pay with browser wallet
      </a>
    </div>
  );
}
