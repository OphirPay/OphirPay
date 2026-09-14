// SPDX-License-Identifier: MIT

export interface ApiKeyUsageInput {
  id: string;
  name: string;
  prefix: string;
  lastUsed: Date | null;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface ApiKeyRequestInput {
  keyId: string;
  createdAt: Date;
}

export interface ApiKeyUsage extends ApiKeyUsageInput {
  total: number;
  window: number;
}

export function aggregateApiKeyUsage(
  keys: ApiKeyUsageInput[],
  requests: ApiKeyRequestInput[],
  since: Date,
): ApiKeyUsage[] {
  const totals = new Map<string, { total: number; window: number }>();
  for (const request of requests) {
    const current = totals.get(request.keyId) ?? { total: 0, window: 0 };
    current.total += 1;
    if (request.createdAt >= since) current.window += 1;
    totals.set(request.keyId, current);
  }

  return keys.map((key) => ({
    ...key,
    total: totals.get(key.id)?.total ?? 0,
    window: totals.get(key.id)?.window ?? 0,
  }));
}