// SPDX-License-Identifier: MIT

import { describe, it, expect } from "vitest";
import { ERROR_CODES, ERROR_STATUS } from "@/lib/error-codes";

describe("ERROR_CODES", () => {
  it("has at least 200 error codes", () => {
    const codes = Object.values(ERROR_CODES) as string[];
    expect(codes.length).toBeGreaterThanOrEqual(200);
  });

  it("all error codes have a corresponding HTTP status", () => {
    const codes = Object.values(ERROR_CODES) as string[];
    for (const code of codes) {
      expect(ERROR_STATUS[code]).toBeDefined();
      expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
      expect(ERROR_STATUS[code]).toBeLessThan(600);
    }
  });

  it("all ERROR_STATUS keys correspond to valid error codes", () => {
    const validCodes = new Set(Object.values(ERROR_CODES) as string[]);
    const statusKeys = Object.keys(ERROR_STATUS);
    for (const key of statusKeys) {
      expect(validCodes.has(key)).toBe(true);
    }
  });

  it("every category has the right status range", () => {
    expect(ERROR_STATUS[ERROR_CODES.BAD_REQUEST]).toBe(400);
    expect(ERROR_STATUS[ERROR_CODES.UNAUTHORIZED]).toBe(401);
    expect(ERROR_STATUS[ERROR_CODES.FORBIDDEN]).toBe(403);
    expect(ERROR_STATUS[ERROR_CODES.NOT_FOUND]).toBe(404);
    expect(ERROR_STATUS[ERROR_CODES.METHOD_NOT_ALLOWED]).toBe(405);
    expect(ERROR_STATUS[ERROR_CODES.CONFLICT]).toBe(409);
    expect(ERROR_STATUS[ERROR_CODES.RATE_LIMITED]).toBe(429);
    expect(ERROR_STATUS[ERROR_CODES.INTERNAL_ERROR]).toBe(500);
    expect(ERROR_STATUS[ERROR_CODES.SERVICE_UNAVAILABLE]).toBe(503);
  });

  it("400 client error codes are defined", () => {
    expect(ERROR_CODES.MISSING_REQUIRED_FIELD).toBeDefined();
    expect(ERROR_CODES.INVALID_INPUT).toBeDefined();
    expect(ERROR_CODES.INVALID_FORMAT).toBeDefined();
    expect(ERROR_CODES.CSV_IMPORT_ERROR).toBeDefined();
    expect(ERROR_CODES.DATE_RANGE_INVALID).toBeDefined();
    expect(ERROR_CODES.INVALID_SIGNATURE).toBeDefined();
    expect(ERROR_CODES.INVALID_CHALLENGE).toBeDefined();
    expect(ERROR_CODES.CHALLENGE_EXPIRED).toBeDefined();
  });

  it("401 auth error codes are defined", () => {
    expect(ERROR_CODES.TOKEN_EXPIRED).toBeDefined();
    expect(ERROR_CODES.TOKEN_MISSING).toBeDefined();
    expect(ERROR_CODES.SESSION_EXPIRED).toBeDefined();
    expect(ERROR_CODES.INVALID_CREDENTIALS).toBeDefined();
    expect(ERROR_CODES.API_KEY_DISABLED).toBeDefined();
  });

  it("403 authorization error codes are defined", () => {
    expect(ERROR_CODES.INSUFFICIENT_PERMISSIONS).toBeDefined();
    expect(ERROR_CODES.ROLE_REQUIRED).toBeDefined();
    expect(ERROR_CODES.NOT_ADMIN).toBeDefined();
    expect(ERROR_CODES.ACCOUNT_DISABLED).toBeDefined();
    expect(ERROR_CODES.REGION_RESTRICTED).toBeDefined();
  });

  it("404 not-found error codes are defined", () => {
    expect(ERROR_CODES.USER_NOT_FOUND).toBeDefined();
    expect(ERROR_CODES.ACCOUNT_NOT_FOUND).toBeDefined();
    expect(ERROR_CODES.CONTRACT_NOT_FOUND).toBeDefined();
    expect(ERROR_CODES.ROUTE_NOT_FOUND).toBeDefined();
  });

  it("408 timeout codes are defined", () => {
    expect(ERROR_CODES.REQUEST_TIMEOUT).toBeDefined();
    expect(ERROR_CODES.TRANSACTION_TIMEOUT).toBeDefined();
    expect(ERROR_CODES.CONTRACT_TIMEOUT).toBeDefined();
    expect(ERROR_CODES.RPC_TIMEOUT).toBeDefined();
  });

  it("409 conflict codes are defined", () => {
    expect(ERROR_CODES.STATE_CONFLICT).toBeDefined();
    expect(ERROR_CODES.VERSION_CONFLICT).toBeDefined();
    expect(ERROR_CODES.SEQUENCE_NUMBER_MISMATCH).toBeDefined();
    expect(ERROR_CODES.OPERATION_IN_PROGRESS).toBeDefined();
    expect(ERROR_CODES.USER_EXISTS).toBeDefined();
    expect(ERROR_CODES.WEBHOOK_EXISTS).toBeDefined();
  });

  it("410 gone codes are defined", () => {
    expect(ERROR_CODES.RESOURCE_DELETED).toBeDefined();
    expect(ERROR_CODES.CONTRACT_DEPRECATED).toBeDefined();
  });

  it("413 payload too large codes are defined", () => {
    expect(ERROR_CODES.PAYLOAD_TOO_LARGE).toBeDefined();
    expect(ERROR_CODES.BATCH_TOO_LARGE).toBeDefined();
    expect(ERROR_CODES.FILE_TOO_LARGE).toBeDefined();
  });

  it("429 rate limit codes are defined", () => {
    expect(ERROR_CODES.RATE_LIMIT_IP).toBeDefined();
    expect(ERROR_CODES.RATE_LIMIT_USER).toBeDefined();
    expect(ERROR_CODES.RATE_LIMIT_WALLET).toBeDefined();
    expect(ERROR_CODES.RATE_LIMIT_API_KEY).toBeDefined();
    expect(ERROR_CODES.RATE_LIMIT_BACKOFF).toBeDefined();
  });

  it("500 server error codes are defined", () => {
    expect(ERROR_CODES.DATABASE_QUERY_FAILED).toBeDefined();
    expect(ERROR_CODES.DATABASE_DEADLOCK).toBeDefined();
    expect(ERROR_CODES.CONTRACT_CALL_FAILED).toBeDefined();
    expect(ERROR_CODES.CONTRACT_VERIFY_FAILED).toBeDefined();
    expect(ERROR_CODES.RPC_ERROR).toBeDefined();
    expect(ERROR_CODES.STELLAR_ERROR).toBeDefined();
    expect(ERROR_CODES.HORIZON_ERROR).toBeDefined();
    expect(ERROR_CODES.SOROBAN_ERROR).toBeDefined();
    expect(ERROR_CODES.EMAIL_SEND_FAILED).toBeDefined();
    expect(ERROR_CODES.NOTIFICATION_FAILED).toBeDefined();
    expect(ERROR_CODES.WEBHOOK_DELIVERY_FAILED).toBeDefined();
    expect(ERROR_CODES.FILE_UPLOAD_FAILED).toBeDefined();
    expect(ERROR_CODES.EXPORT_FAILED).toBeDefined();
    expect(ERROR_CODES.SEARCH_INDEX_ERROR).toBeDefined();
    expect(ERROR_CODES.CACHE_ERROR).toBeDefined();
    expect(ERROR_CODES.CONFIG_ERROR).toBeDefined();
    expect(ERROR_CODES.MAINTENANCE_MODE).toBeDefined();
  });

  it("503 service unavailable codes are defined", () => {
    expect(ERROR_CODES.OVERLOADED).toBeDefined();
    expect(ERROR_CODES.DEPENDENCY_UNAVAILABLE).toBeDefined();
    expect(ERROR_CODES.STELLAR_UNAVAILABLE).toBeDefined();
    expect(ERROR_CODES.HORIZON_UNAVAILABLE).toBeDefined();
    expect(ERROR_CODES.SOROBAN_UNAVAILABLE).toBeDefined();
    expect(ERROR_CODES.RPC_UNAVAILABLE).toBeDefined();
    expect(ERROR_CODES.DATABASE_UNAVAILABLE).toBeDefined();
  });

  it("payment-specific codes are defined", () => {
    expect(ERROR_CODES.PAYMENT_FAILED).toBeDefined();
    expect(ERROR_CODES.INSUFFICIENT_FUNDS).toBeDefined();
    expect(ERROR_CODES.INSUFFICIENT_RESERVE).toBeDefined();
    expect(ERROR_CODES.TRANSACTION_FAILED).toBeDefined();
    expect(ERROR_CODES.TRANSACTION_EXPIRED).toBeDefined();
    expect(ERROR_CODES.STREAM_PAUSED).toBeDefined();
    expect(ERROR_CODES.BATCH_PROCESSING).toBeDefined();
    expect(ERROR_CODES.ESCROW_EXPIRED).toBeDefined();
    expect(ERROR_CODES.ESCROW_DISPUTED).toBeDefined();
  });

  it("multisig-specific codes are defined", () => {
    expect(ERROR_CODES.THRESHOLD_NOT_MET).toBeDefined();
    expect(ERROR_CODES.ALREADY_APPROVED).toBeDefined();
    expect(ERROR_CODES.ALREADY_EXECUTED).toBeDefined();
    expect(ERROR_CODES.INVALID_THRESHOLD).toBeDefined();
    expect(ERROR_CODES.SIGNER_LIMIT_EXCEEDED).toBeDefined();
    expect(ERROR_CODES.SIGNER_WEIGHT_EXCEEDED).toBeDefined();
    expect(ERROR_CODES.MULTISIG_NOT_CONFIGURED).toBeDefined();
  });

  it("governance-specific codes are defined", () => {
    expect(ERROR_CODES.PROPOSAL_NOT_FOUND).toBeDefined();
    expect(ERROR_CODES.VOTING_ENDED).toBeDefined();
    expect(ERROR_CODES.PROPOSAL_ALREADY_EXECUTED).toBeDefined();
    expect(ERROR_CODES.PROPOSAL_EXPIRED).toBeDefined();
    expect(ERROR_CODES.PROPOSAL_CANCELLED).toBeDefined();
    expect(ERROR_CODES.PROPOSAL_NOT_ACTIVE).toBeDefined();
    expect(ERROR_CODES.ALREADY_VOTED).toBeDefined();
    expect(ERROR_CODES.QUORUM_NOT_MET).toBeDefined();
    expect(ERROR_CODES.INSUFFICIENT_VOTING_POWER).toBeDefined();
  });

  it("wallet-specific codes are defined", () => {
    expect(ERROR_CODES.WALLET_NOT_INSTALLED).toBeDefined();
    expect(ERROR_CODES.WALLET_CONNECTION_FAILED).toBeDefined();
    expect(ERROR_CODES.WALLET_DISCONNECTED).toBeDefined();
    expect(ERROR_CODES.WALLET_NETWORK_MISMATCH).toBeDefined();
    expect(ERROR_CODES.WALLET_SIGN_FAILED).toBeDefined();
    expect(ERROR_CODES.WALLET_SIGN_REJECTED).toBeDefined();
    expect(ERROR_CODES.WALLET_NOT_SUPPORTED).toBeDefined();
  });

  it("no duplicate error names in ERROR_CODES", () => {
    const codes = Object.values(ERROR_CODES) as string[];
    const unique = new Set(codes);
    expect(unique.size).toBe(codes.length);
  });

  it("every ERROR_STATUS has a valid HTTP code", () => {
    const validHttpCodes = [400, 401, 402, 403, 404, 405, 406, 408, 409, 410, 413, 415, 422, 429, 451, 500, 503];
    for (const [, status] of Object.entries(ERROR_STATUS)) {
      expect(validHttpCodes).toContain(status);
    }
  });
});
