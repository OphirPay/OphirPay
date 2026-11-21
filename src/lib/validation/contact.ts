// SPDX-License-Identifier: MIT

import { z } from "zod";

import { isValidStellarAddress } from "@/lib/stellar";

export const CONTACT_NAME_MAX_LENGTH = 64;

/**
 * Strips HTML and script tags from an input string, then escapes HTML special entities
 * (&, <, >, ", ') to prevent stored Cross-Site Scripting (XSS).
 */
export function sanitizeContactName(input: string): string {
  if (typeof input !== "string") return "";
  // Strip <script>...</script> tags and contents first
  const noScript = input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  // Strip any remaining HTML tags (e.g. <b>, </div>, <img ...>, etc.)
  const stripped = noScript.replace(/<[/!]?[a-zA-Z][^>]*>/g, "");
  // Escape special HTML entities
  return stripped
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .trim();
}

/**
 * Zod schema for contact name validation.
 * Enforces trimming, maximum character length of 64 characters, and HTML sanitization.
 */
export const contactNameSchema = z
  .string({ error: "Contact name is required" })
  .trim()
  .min(1, "Contact name cannot be empty")
  .max(
    CONTACT_NAME_MAX_LENGTH,
    `Contact name must be ${CONTACT_NAME_MAX_LENGTH} characters or fewer`
  )
  .transform((val) => sanitizeContactName(val));

/**
 * Schema for AddressBook contact creation/mutation.
 * Supports both `name` / `label` and `address` / `publicKey`.
 */
export const contactSchema = z
  .object({
    name: contactNameSchema.optional(),
    label: contactNameSchema.optional(),
    address: z
      .string()
      .trim()
      .refine(isValidStellarAddress, "Invalid Stellar address")
      .optional(),
    publicKey: z
      .string()
      .trim()
      .refine(isValidStellarAddress, "Invalid Stellar address")
      .optional(),
    memo: z.string().trim().max(28, "Memo must be 28 characters or fewer").optional(),
  })
  .refine((data) => Boolean(data.name || data.label), {
    message: "Contact name is required",
    path: ["name"],
  })
  .refine((data) => Boolean(data.address || data.publicKey), {
    message: "Valid Stellar address is required",
    path: ["address"],
  });

export type ContactInput = z.infer<typeof contactSchema>;
