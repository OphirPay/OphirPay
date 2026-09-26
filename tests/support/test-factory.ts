// SPDX-License-Identifier: MIT

import type { Payment, Batch, BatchRecipient } from "@/types";

/**
 * Test data factories for consistent test data across test suites.
 * Each factory produces a valid default object that can be overridden.
 */

let idCounter = 0;
function nextId(): string {
  return `test_${++idCounter}_${Date.now()}`;
}

export function createTestPayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: nextId(),
    amount: 100,
    status: "COMPLETED",
    assetCode: "XLM",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sourceAccountId: "GACZ7ZELCUC5YGJ6JHIVLEZNR3XKYKOVUWD6H3IRFPRZMALNUYJZQM2U",
    destAccountId: "GBD4R7KL1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZABCD",
    transactionHash: "abc123def456abc123def456abc123def456abc123def456",
    ...overrides,
  };
}

export function createTestBatch(overrides: Partial<Batch> = {}): Batch {
  return {
    id: nextId(),
    userId: "test-user",
    name: "Test Batch",
    status: "COMPLETED",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    payments: [],
    ...overrides,
  };
}

export function createTestRecipient(
  overrides: Partial<BatchRecipient> = {}
): BatchRecipient {
  return {
    address: "GBD4R7KL1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZABCD",
    amount: 10,
    assetCode: "XLM",
    ...overrides,
  };
}

/**
 * Create an array of N test payments.
 */
export function createTestPayments(count: number): Payment[] {
  return Array.from({ length: count }, (_, i) =>
    createTestPayment({ id: `pay_${i}`, amount: (i + 1) * 100 })
  );
}
