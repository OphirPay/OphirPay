// SPDX-License-Identifier: MIT

import { describe, expect,it } from "vitest";

import {
  formatOnChainEvent,
  type FormattedEvent,
  groupEventsByType,
  sortEventsByDate,
} from "@/lib/contract-events";
import type { OnChainPayment } from "@/lib/contracts";
import { XLM_STROOPS } from "@/lib/stellar";

describe("contract event deserializer", () => {
  describe("formatOnChainEvent with missing optional fields", () => {
    it("handles event payload with missing optional memo field", () => {
      const payment: OnChainPayment = {
        id: 1,
        payer: "GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIBTGONTOPDMAUNDIGUID6DP42V",
        payee: "GBUJZ4CI3LA52XZMBNQVULCNQ施展EJA7SXWDTOJRXE54B2KUUCCA5",
        amountStroops: 10000000,
        txHash: "abc123def456",
        // memo (metadata) is intentionally missing
      };

      const result = formatOnChainEvent(payment);

      expect(result).toBeDefined();
      expect(result.id).toBe("evt_1");
      expect(result.metadata).toBeUndefined();
      expect(result.timestamp).toBeUndefined();
      expect(result.status).toBe("COMPLETED"); // No metadata means not cancelled
    });

    it("handles event with missing timestamp field", () => {
      const payment: OnChainPayment = {
        id: 2,
        payer: "GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIBTGONTOPDMAUNDIGUID6DP42V",
        payee: "GBUJZ4CI3LA52XZMBNQVULCNQSJ5WKWPO5Z5LCLVCCUVE7EZYJAA5Z3",
        amountStroops: 5000000000,
        txHash: "xyz789",
        metadata: "payment_id_123",
        // timestamp is intentionally missing
      };

      const result = formatOnChainEvent(payment);

      expect(result.timestamp).toBeUndefined();
      expect(result.metadata).toBe("payment_id_123");
      expect(result.status).toBe("COMPLETED");
    });

    it("handles legacy event with only required fields", () => {
      const payment: OnChainPayment = {
        id: 3,
        payer: "GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIBTGONTOPDMAUNDIGUID6DP42V",
        payee: "GBUJZ4CI3LA52XZMBNQVULCNQSJ5WKWPO5Z5LCLVCCUVE7EZYJAA5Z3",
        amountStroops: 25000000,
        txHash: "legacy456",
      };

      const result = formatOnChainEvent(payment);

      expect(result).toBeDefined();
      expect(result.id).toBe("evt_3");
      expect(result.payer).toBe(payment.payer);
      expect(result.payee).toBe(payment.payee);
      expect(result.amountXlm).toBe(2.5);
      expect(result.txHash).toBe("legacy456");
      expect(result.timestamp).toBeUndefined();
      expect(result.metadata).toBeUndefined();
    });

    it("deserializes cancelled status from metadata field", () => {
      const payment: OnChainPayment = {
        id: 4,
        payer: "GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIBTGONTOPDMAUNDIGUID6DP42V",
        payee: "GBUJZ4CI3LA52XZMBNQVULCNQSJ5WKWPO5Z5LCLVCCUVE7EZYJAA5Z3",
        amountStroops: 10000000,
        txHash: "cancelled_tx",
        metadata: "CANCELLED",
      };

      const result = formatOnChainEvent(payment);

      expect(result.status).toBe("CANCELLED");
    });

    it("converts stroops to XLM correctly without throwing", () => {
      const payment: OnChainPayment = {
        id: 5,
        payer: "GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIBTGONTOPDMAUNDIGUID6DP42V",
        payee: "GBUJZ4CI3LA52XZMBNQVULCNQSJ5WKWPO5Z5LCLVCCUVE7EZYJAA5Z3",
        amountStroops: 12345678900,
        txHash: "conversion_test",
      };

      expect(() => {
        const result = formatOnChainEvent(payment);
        expect(result.amountXlm).toBe(12345678900 / XLM_STROOPS);
      }).not.toThrow();
    });

    it("preserves all fields even when optional ones are undefined", () => {
      const payment: OnChainPayment = {
        id: 6,
        payer: "GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIBTGONTOPDMAUNDIGUID6DP42V",
        payee: "GBUJZ4CI3LA52XZMBNQVULCNQSJ5WKWPO5Z5LCLVCCUVE7EZYJAA5Z3",
        amountStroops: 10000000,
        txHash: "full_event",
        timestamp: 1699000000,
        metadata: "ref_xyz",
      };

      const result = formatOnChainEvent(payment);

      expect(result.id).toBe("evt_6");
      expect(result.type).toBe("payment.created");
      expect(result.payer).toBe(payment.payer);
      expect(result.payee).toBe(payment.payee);
      expect(result.amountXlm).toBe(1);
      expect(result.txHash).toBe("full_event");
      expect(result.timestamp).toBe(1699000000);
      expect(result.metadata).toBe("ref_xyz");
    });
  });

  describe("groupEventsByType", () => {
    it("groups events by type without throwing on missing optional fields", () => {
      const events: FormattedEvent[] = [
        {
          id: "evt_1",
          type: "payment.created",
          amountXlm: 10,
          payer: "PAYER1",
          payee: "PAYEE1",
          txHash: "hash1",
          status: "COMPLETED",
        },
        {
          id: "evt_2",
          type: "payment.created",
          amountXlm: 20,
          payer: "PAYER2",
          payee: "PAYEE2",
          txHash: "hash2",
          timestamp: undefined,
          metadata: undefined,
          status: "COMPLETED",
        },
      ];

      const grouped = groupEventsByType(events);

      expect(grouped).toHaveLength(1);
      expect(grouped[0].type).toBe("Created");
      expect(grouped[0].count).toBe(2);
      expect(grouped[0].volume).toBe(30);
    });

    it("handles empty event array gracefully", () => {
      const events: FormattedEvent[] = [];

      const grouped = groupEventsByType(events);

      expect(grouped).toEqual([]);
    });
  });

  describe("sortEventsByDate", () => {
    it("sorts events by timestamp with missing optional fields", () => {
      const events: FormattedEvent[] = [
        {
          id: "evt_1",
          type: "payment.created",
          amountXlm: 10,
          payer: "PAYER1",
          payee: "PAYEE1",
          txHash: "hash1",
          timestamp: 1699000000,
          status: "COMPLETED",
        },
        {
          id: "evt_2",
          type: "payment.created",
          amountXlm: 20,
          payer: "PAYER2",
          payee: "PAYEE2",
          txHash: "hash2",
          // timestamp missing
          status: "COMPLETED",
        },
        {
          id: "evt_3",
          type: "payment.created",
          amountXlm: 15,
          payer: "PAYER3",
          payee: "PAYEE3",
          txHash: "hash3",
          timestamp: 1699000100,
          status: "COMPLETED",
        },
      ];

      const sorted = sortEventsByDate(events);

      // Newest first: 1699000100, then 1699000000, then undefined (0)
      expect(sorted[0].timestamp).toBe(1699000100);
      expect(sorted[1].timestamp).toBe(1699000000);
      expect(sorted[2].timestamp).toBeUndefined();
    });

    it("handles array with all missing timestamps", () => {
      const events: FormattedEvent[] = [
        {
          id: "evt_1",
          type: "payment.created",
          amountXlm: 10,
          payer: "PAYER1",
          payee: "PAYEE1",
          txHash: "hash1",
          status: "COMPLETED",
        },
        {
          id: "evt_2",
          type: "payment.created",
          amountXlm: 20,
          payer: "PAYER2",
          payee: "PAYEE2",
          txHash: "hash2",
          status: "COMPLETED",
        },
      ];

      const sorted = sortEventsByDate(events);

      expect(sorted).toHaveLength(2);
      expect(sorted[0].id).toBe("evt_1"); // Original order maintained for equal timestamps
      expect(sorted[1].id).toBe("evt_2");
    });
  });

  describe("backwards compatibility with legacy events", () => {
    it("maintains backwards compatibility when contracts are upgraded with new fields", () => {
      // Legacy event without optional fields
      const legacyPayment: OnChainPayment = {
        id: 100,
        payer: "GBUQWP3BOUZX34ULNQG23RQ6F4BVWCIBTGONTOPDMAUNDIGUID6DP42V",
        payee: "GBUJZ4CI3LA52XZMBNQVULCNQSJ5WKWPO5Z5LCLVCCUVE7EZYJAA5Z3",
        amountStroops: 10000000,
        txHash: "legacy_hash",
      };

      // Should not throw and should deserialize correctly
      expect(() => {
        const result = formatOnChainEvent(legacyPayment);
        expect(result.id).toBe("evt_100");
        expect(result.type).toBe("payment.created");
        expect(result.status).toBe("COMPLETED");
      }).not.toThrow();
    });

    it("handles corrupted or invalid payloads gracefully", () => {
      // Minimal valid payment object
      const minimalPayment: OnChainPayment = {
        id: 999,
        payer: "",
        payee: "",
        amountStroops: 0,
        txHash: "",
      };

      expect(() => {
        const result = formatOnChainEvent(minimalPayment);
        expect(result).toBeDefined();
        expect(result.id).toBe("evt_999");
        expect(result.amountXlm).toBe(0);
      }).not.toThrow();
    });
  });
});
