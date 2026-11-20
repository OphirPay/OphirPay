// SPDX-License-Identifier: MIT

import { beforeEach,describe, expect, it, vi } from "vitest";

import { GET,POST } from "@/app/api/contacts/route";
import {
  CONTACT_NAME_MAX_LENGTH,
  contactNameSchema,
  contactSchema,
  sanitizeContactName,
} from "@/lib/validation/contact";

vi.mock("@/lib/auth-session", () => ({
  getAuthContext: vi.fn(),
}));

vi.mock("@/lib/csrf", () => ({
  verifyCsrf: vi.fn().mockReturnValue(null),
}));

import { type AuthContext,getAuthContext } from "@/lib/auth-session";

const VALID_STELLAR = "GDV4VOJNQL7UAPHPOH7BLFOG3CJZ2A65FCHTYWPHZVMQ3OQG5W757FCE";
const MOCK_AUTH: AuthContext = { userId: "u1", publicKey: VALID_STELLAR };

describe("Contact name sanitization and validation (Issue #1949)", () => {
  describe("sanitizeContactName", () => {
    it("strips script tags and their contents", () => {
      expect(sanitizeContactName("<script>alert('xss')</script>Alice")).toBe("Alice");
      expect(sanitizeContactName("Bob<script src='evil.js'></script>")).toBe("Bob");
    });

    it("strips HTML formatting tags", () => {
      expect(sanitizeContactName("<b>Charlie</b>")).toBe("Charlie");
      expect(sanitizeContactName("<i>Dave</i> <img src=x onerror=alert(1)>")).toBe("Dave");
    });

    it("escapes special HTML characters (&, <, >, \", ')", () => {
      expect(sanitizeContactName("Alice & Bob")).toBe("Alice &amp; Bob");
      expect(sanitizeContactName("x < y > z")).toBe("x &lt; y &gt; z");
      expect(sanitizeContactName('"Quote" and \'Single\'')).toBe(
        "&quot;Quote&quot; and &#x27;Single&#x27;"
      );
    });

    it("handles empty or non-string inputs safely", () => {
      expect(sanitizeContactName("")).toBe("");
      expect(sanitizeContactName(null as unknown as string)).toBe("");
      expect(sanitizeContactName(undefined as unknown as string)).toBe("");
    });
  });

  describe("contactNameSchema", () => {
    it("accepts names up to 64 characters", () => {
      const validName = "A".repeat(64);
      const result = contactNameSchema.safeParse(validName);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(validName);
      }
    });

    it("rejects names greater than 64 characters", () => {
      const longName = "A".repeat(65);
      const result = contactNameSchema.safeParse(longName);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain(
          `Contact name must be ${CONTACT_NAME_MAX_LENGTH} characters or fewer`
        );
      }
    });

    it("rejects empty names", () => {
      expect(contactNameSchema.safeParse("").success).toBe(false);
      expect(contactNameSchema.safeParse("   ").success).toBe(false);
    });

    it("sanitizes HTML tags during parsing", () => {
      const result = contactNameSchema.safeParse("<script>alert(1)</script>John Doe");
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe("John Doe");
      }
    });
  });

  describe("contactSchema", () => {
    it("accepts valid contact payload with name and address", () => {
      const result = contactSchema.safeParse({
        name: "Alice Cooper",
        address: VALID_STELLAR,
      });
      expect(result.success).toBe(true);
    });

    it("accepts label and publicKey aliases", () => {
      const result = contactSchema.safeParse({
        label: "Bob Dylan",
        publicKey: VALID_STELLAR,
        memo: "12345",
      });
      expect(result.success).toBe(true);
    });

    it("rejects contacts without name or label", () => {
      const result = contactSchema.safeParse({
        address: VALID_STELLAR,
      });
      expect(result.success).toBe(false);
    });

    it("rejects contacts with invalid Stellar address", () => {
      const result = contactSchema.safeParse({
        name: "Charlie",
        address: "INVALID_ADDRESS",
      });
      expect(result.success).toBe(false);
    });

    it("rejects contacts with name exceeding 64 chars", () => {
      const result = contactSchema.safeParse({
        name: "A".repeat(65),
        address: VALID_STELLAR,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("Contacts API Route (POST & GET /api/contacts)", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("requires authentication for GET", async () => {
      vi.mocked(getAuthContext).mockResolvedValueOnce(null);
      const res = await GET(new Request("http://localhost/api/contacts"));
      expect(res.status).toBe(401);
    });

    it("returns contact list for authenticated GET", async () => {
      vi.mocked(getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const res = await GET(new Request("http://localhost/api/contacts"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it("creates sanitized contact via POST", async () => {
      vi.mocked(getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const req = new Request("http://localhost/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "<script>alert(1)</script>Bob & Alice",
          address: VALID_STELLAR,
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.name).toBe("Bob &amp; Alice");
    });

    it("rejects contact with name > 64 characters via POST", async () => {
      vi.mocked(getAuthContext).mockResolvedValueOnce(MOCK_AUTH);
      const req = new Request("http://localhost/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "X".repeat(65),
          address: VALID_STELLAR,
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
    });
  });
});
