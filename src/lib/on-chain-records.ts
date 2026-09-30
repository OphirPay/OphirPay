// SPDX-License-Identifier: MIT

type RecordCollection = "escrows" | "streams";

interface CountResponse {
  count: number;
  available?: boolean;
  error?: string;
}

const RECENT_RECORD_LIMIT = 20;

/**
 * The contract exposes item-by-id reads rather than an enumeration method.
 * Query the newest bounded range so dashboard loads don't fan out over all
 * historical records.
 */
export async function fetchRecentContractRecords<T extends { id: number }>(
  collection: RecordCollection,
): Promise<T[]> {
  const countResponse = await fetch(`/api/${collection}`, { credentials: "same-origin" });
  const countBody = (await countResponse.json()) as { data?: CountResponse; error?: { message?: string } };
  if (!countResponse.ok) {
    throw new Error(countBody.error?.message || `Failed to load ${collection}.`);
  }
  const countData = countBody.data ?? (countBody as unknown as CountResponse);
  if (countData.available === false) {
    throw new Error(countData.error || `The ${collection} contract is unavailable.`);
  }
  if (!Number.isSafeInteger(countData.count) || countData.count < 0) {
    throw new Error(`The ${collection} contract returned an invalid count.`);
  }

  const firstId = Math.max(1, countData.count - RECENT_RECORD_LIMIT + 1);
  const results = await Promise.all(
    Array.from({ length: countData.count === 0 ? 0 : countData.count - firstId + 1 }, (_, index) =>
      fetch(`/api/${collection}/${countData.count - index}`, { credentials: "same-origin" }).then(async (response) => {
        if (response.status === 404) return null;
        const body = (await response.json()) as { data?: T; error?: { message?: string } };
        if (!response.ok) {
          throw new Error(body.error?.message || `Failed to load ${collection} record.`);
        }
        return (body.data ?? body) as T;
      }),
    ),
  );
  return results.filter((record) => record !== null) as T[];
}
