// SPDX-License-Identifier: MIT

/**
 * RFC 9116 `security.txt` document for OphirPay (issue #1280).
 *
 * The repository also keeps a plain `.well-known/security.txt` at its root for
 * browsing and for tooling that reads the file directly. This module is the
 * source of truth for the *served* document; `src/__tests__/security-txt.test.ts`
 * asserts that both stay in sync so a researcher can never be pointed at a
 * retired mailbox.
 *
 * Only the GitHub private-advisory form is advertised: it is the one channel
 * that does not depend on mail infrastructure. `security@ophirpay.com` has no
 * MX record and `security@ophirpay.dev` does not resolve, so listing either as
 * a `mailto:` contact would send reports into a void. Add a `mailto:` entry
 * here (and to the repository file) only once a monitored mailbox exists.
 */
export const SECURITY_TXT_CONTACTS = [
  "https://github.com/OphirPay/OphirPay/security/advisories/new",
] as const;

const DEFAULT_APP_URL = "https://ophirpay.vercel.app";

/** A security.txt is stale after ~1 year; RFC 9116 requires the field. */
export const SECURITY_TXT_EXPIRES = "2027-08-28T00:00:00.000Z";

export function generateSecurityTxt(
  appUrl: string = process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL,
): string {
  const base = appUrl.replace(/\/$/, "");
  const lines = [
    ...SECURITY_TXT_CONTACTS.map((contact) => `Contact: ${contact}`),
    `Expires: ${SECURITY_TXT_EXPIRES}`,
    "Preferred-Languages: en",
    `Canonical: ${base}/.well-known/security.txt`,
    "Policy: https://github.com/OphirPay/OphirPay/blob/main/SECURITY.md",
    "",
  ];
  return lines.join("\n");
}
