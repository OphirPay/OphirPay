// SPDX-License-Identifier: MIT

/**
 * URL / image-URL sanitizer (issue #1391).
 *
 * Asset logos are attacker-controlled: an issuing account's `stellar.toml`
 * (`[[CURRENCIES]].image`) and user profile records can hold any string. If
 * that string is rendered into an `<img src>` — or worse, into an `<svg>` /
 * `dangerouslySetInnerHTML` sink — a `javascript:`/`vbscript:` URI, a
 * `data:image/svg+xml` document with an inline `<script>`, or a `data:text/html`
 * payload can execute in the application's origin.
 *
 * This module is the single choke point that decides whether a URL is safe to
 * hand to an image renderer. It intentionally:
 *
 *   • allows only `https:` URLs (blocking `http:`, `javascript:`, `vbscript:`,
 *     `file:`, `blob:`, `ftp:`, protocol-relative `//host` and same-origin paths
 *     that could be repointed at a script),
 *   • allows only base64 `data:` URIs whose media type is a raster format
 *     (`image/png`, `image/jpeg`, `image/webp`) — never `image/svg+xml`
 *     (SVG is a scripting format) or `image/gif`/`text/html`,
 *   • rejects any string carrying a script-bearing fragment (`<script`,
 *     `onload=`, `onerror=`, …), and
 *   • strips the NUL / C0 / C1 control characters and surrounding whitespace
 *     that HTML parsers ignore, so `java\tscript:` cannot smuggle a scheme past
 *     a naïve prefix check.
 *
 * Callers that render the returned value MUST still use it in an attribute
 * context (`<img src={url} referrerPolicy="no-referrer">`) and never as raw
 * HTML. Returning `null` means "do not render an image; fall back to the text
 * badge" — callers must not substitute the original string.
 */

/** Raster data-URI media types that cannot carry script. */
export const ALLOWED_IMAGE_DATA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
] as const;

/** Reject absurdly long inputs before any parsing work. */
const MAX_URL_LENGTH = 2048;

const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F-\u009F]/g;

/** Script-bearing fragments that must never reach a renderer. */
// `on[a-z]+=` only counts as an event handler when it is not preceded by a
// word character, so a query string like `?monkey=1` is not a false positive.
const SCRIPT_PAYLOAD_RE =
  /(<script|<\/script|<svg|javascript:|vbscript:|(?:^|[^a-z0-9_])on[a-z]+\s*=)/i;

/**
 * Remove the control characters and whitespace that browsers strip while
 * parsing a URL, then trim. This closes the `java&#9;script:` /
 * `\njavascript:` obfuscation class.
 */
function normalize(raw: string): string {
  return raw.replace(CONTROL_CHARS_RE, "").trim();
}

interface ParsedDataUri {
  mediaType: string;
  base64: boolean;
}

/** Parse `data:[<mediatype>][;base64],<data>`, or `null` when malformed. */
function parseDataUri(url: string): ParsedDataUri | null {
  const match = /^data:([^,]*),([\s\S]*)$/i.exec(url);
  if (!match) return null;
  const meta = match[1] ?? "";
  const params = meta.split(";").map((part) => part.trim().toLowerCase());
  return {
    mediaType: params[0] ?? "",
    base64: params.includes("base64"),
  };
}

/**
 * Return the URL unchanged when it is a safe image source, otherwise `null`.
 *
 * Accepts `https:` URLs and base64 `data:` URIs of an allowed raster media
 * type. Everything else — including `data:image/svg+xml`, non-base64 data
 * URIs (which can carry an inline document), and any string with a
 * script-bearing fragment — returns `null`.
 */
export function sanitizeImageUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  const normalized = normalize(raw);
  if (normalized.length === 0 || normalized.length > MAX_URL_LENGTH) return null;
  if (SCRIPT_PAYLOAD_RE.test(normalized)) return null;

  const lower = normalized.toLowerCase();

  if (lower.startsWith("data:")) {
    const parsed = parseDataUri(normalized);
    if (!parsed) return null;
    if (
      !(ALLOWED_IMAGE_DATA_TYPES as readonly string[]).includes(parsed.mediaType)
    ) {
      return null;
    }
    // Only base64-encoded payloads: a non-base64 `data:` URL is a raw document
    // (e.g. `data:image/png,<svg …>`), which the media type alone cannot vouch
    // for.
    if (!parsed.base64) return null;
    return normalized;
  }

  // Only absolute https URLs. This single check rejects `http:`, `javascript:`,
  // `vbscript:`, `file:`, `blob:`, `ftp:`, protocol-relative `//host/x`, and
  // relative/absolute-path strings in one place.
  if (!lower.startsWith("https://")) return null;

  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:") return null;
    // Canonicalize through URL so any residual quoting/markup is percent-encoded
    // and the rendered attribute can never break out of the `src` value.
    return url.href;
  } catch {
    return null;
  }
}

/** Convenience predicate — `true` when {@link sanitizeImageUrl} accepts `raw`. */
export function isSafeImageUrl(raw: unknown): boolean {
  return sanitizeImageUrl(raw) !== null;
}
