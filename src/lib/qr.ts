// SPDX-License-Identifier: MIT

import { isValidStellarAddress } from "@/lib/stellar";

/**
 * SEP-0007 (SEP-7) URI generation and parsing utilities.
 * Specification: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md
 */

export type Sep7MemoType = "MEMO_TEXT" | "MEMO_ID" | "MEMO_HASH" | "MEMO_RETURN";

export interface Sep7PayUriOptions {
  /** Recipient Stellar public key or muxed account (G... or M...) */
  destination: string;
  /** Amount to send */
  amount?: string | number;
  /** Asset code (e.g., XLM, USDC) */
  assetCode?: string;
  /** Asset issuer account ID (for non-native assets) */
  assetIssuer?: string;
  /** Memo value */
  memo?: string;
  /** Memo type */
  memoType?: Sep7MemoType | string;
  /** Message displayed to the payer */
  msg?: string;
  /** Optional callback URL to submit transaction */
  callback?: string;
  /** Network passphrase */
  networkPassphrase?: string;
  /** Origin domain of the request */
  originDomain?: string;
}

/**
 * Generates a SEP-0007 compliant `web+stellar:pay` URI for receiving payments.
 * Validates destination address.
 */
export function generateSep7PayUri(options: Sep7PayUriOptions): string {
  if (!options.destination || typeof options.destination !== "string") {
    throw new Error("Destination address is required for SEP-0007 pay URI");
  }

  const destination = options.destination.trim();
  if (!isValidStellarAddress(destination)) {
    throw new Error(`Invalid Stellar destination address: ${destination}`);
  }

  const params = new URLSearchParams();
  params.set("destination", destination);

  if (options.amount !== undefined && options.amount !== null && options.amount !== "") {
    const amtStr = String(options.amount).trim();
    if (amtStr) {
      params.set("amount", amtStr);
    }
  }

  if (options.assetCode) {
    const code = options.assetCode.trim();
    if (code && code.toUpperCase() !== "XLM" && code.toUpperCase() !== "NATIVE") {
      params.set("asset_code", code);
      if (options.assetIssuer) {
        params.set("asset_issuer", options.assetIssuer.trim());
      }
    }
  }

  if (options.memo) {
    params.set("memo", options.memo.trim());
    if (options.memoType) {
      params.set("memo_type", options.memoType.trim());
    }
  }

  if (options.msg) {
    params.set("msg", options.msg.trim());
  }

  if (options.callback) {
    params.set("callback", options.callback.trim());
  }

  if (options.networkPassphrase) {
    params.set("network_passphrase", options.networkPassphrase.trim());
  }

  if (options.originDomain) {
    params.set("origin_domain", options.originDomain.trim());
  }

  return `web+stellar:pay?${params.toString()}`;
}

/**
 * Parses a SEP-0007 `web+stellar:pay` or `stellar:pay` URI into options.
 * Returns null if URI is invalid or destination address is invalid.
 */
export function parseSep7PayUri(uri: string): Sep7PayUriOptions | null {
  if (!uri || typeof uri !== "string") return null;

  try {
    let queryString = "";
    if (uri.startsWith("web+stellar:pay?")) {
      queryString = uri.slice("web+stellar:pay?".length);
    } else if (uri.startsWith("web+stellar:pay")) {
      queryString = uri.slice("web+stellar:pay".length);
      if (queryString.startsWith("?")) queryString = queryString.slice(1);
    } else if (uri.startsWith("stellar:pay?")) {
      queryString = uri.slice("stellar:pay?".length);
    } else if (uri.startsWith("stellar:pay")) {
      queryString = uri.slice("stellar:pay".length);
      if (queryString.startsWith("?")) queryString = queryString.slice(1);
    } else if (uri.includes("?")) {
      queryString = uri.slice(uri.indexOf("?") + 1);
    } else {
      return null;
    }

    const params = new URLSearchParams(queryString);
    const destination = params.get("destination");
    if (!destination || !isValidStellarAddress(destination)) {
      return null;
    }

    const result: Sep7PayUriOptions = { destination };

    const amount = params.get("amount");
    if (amount) result.amount = amount;

    const assetCode = params.get("asset_code");
    if (assetCode) result.assetCode = assetCode;

    const assetIssuer = params.get("asset_issuer");
    if (assetIssuer) result.assetIssuer = assetIssuer;

    const memo = params.get("memo");
    if (memo) result.memo = memo;

    const memoType = params.get("memo_type");
    if (memoType) result.memoType = memoType as Sep7MemoType;

    const msg = params.get("msg");
    if (msg) result.msg = msg;

    const callback = params.get("callback");
    if (callback) result.callback = callback;

    const networkPassphrase = params.get("network_passphrase");
    if (networkPassphrase) result.networkPassphrase = networkPassphrase;

    const originDomain = params.get("origin_domain");
    if (originDomain) result.originDomain = originDomain;

    return result;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Pure TypeScript QR Code Generator (ISO/IEC 18004 Compliant)
// Zero external runtime dependencies.
// ─────────────────────────────────────────────────────────────

export type QrErrorCorrectionLevel = "L" | "M" | "Q" | "H";

export interface QrSvgOptions {
  /** Size in pixels for width & height (default: 256) */
  size?: number;
  /** Margin around QR code in modules (default: 4) */
  margin?: number;
  /** Foreground module color (default: "#000000") */
  fgColor?: string;
  /** Background color (default: "#ffffff") */
  bgColor?: string;
  /** Error correction level: L (7%), M (15%), Q (25%), H (30%) (default: 'M') */
  level?: QrErrorCorrectionLevel;
  /** Optional title for accessibility */
  title?: string;
}

// Galois Field GF(256) math with primitive poly 0x11d (285)
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGF() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_EXP[i + 255] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  GF_LOG[0] = 0;
})();

function gfMul(x: number, y: number): number {
  if (x === 0 || y === 0) return 0;
  return GF_EXP[GF_LOG[x] + GF_LOG[y]];
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], root);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly;
}

function rsComputeRemainder(data: Uint8Array, numEc: number): Uint8Array {
  const gen = rsGeneratorPoly(numEc);
  const remainder = new Uint8Array(numEc);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ remainder[0];
    for (let j = 0; j < numEc - 1; j++) {
      remainder[j] = remainder[j + 1] ^ gfMul(gen[j], factor);
    }
    remainder[numEc - 1] = gfMul(gen[numEc - 1], factor);
  }
  return remainder;
}

// Table of QR code versions: [totalCodewords, ecCodewords, ecBlocksGroup1, dataCodewordsGroup1, ecBlocksGroup2, dataCodewordsGroup2]
interface VersionTableEntry {
  totalCodewords: number;
  ecPerBlock: number;
  g1Blocks: number;
  g1Data: number;
  g2Blocks: number;
  g2Data: number;
}

const EC_TABLE: Record<QrErrorCorrectionLevel, VersionTableEntry[]> = {
  L: [
    { totalCodewords: 26, ecPerBlock: 7, g1Blocks: 1, g1Data: 19, g2Blocks: 0, g2Data: 0 },
    { totalCodewords: 44, ecPerBlock: 10, g1Blocks: 1, g1Data: 34, g2Blocks: 0, g2Data: 0 },
    { totalCodewords: 70, ecPerBlock: 15, g1Blocks: 1, g1Data: 55, g2Blocks: 0, g2Data: 0 },
    { totalCodewords: 100, ecPerBlock: 20, g1Blocks: 1, g1Data: 80, g2Blocks: 0, g2Data: 0 },
    { totalCodewords: 134, ecPerBlock: 26, g1Blocks: 1, g1Data: 108, g2Blocks: 0, g2Data: 0 },
    { totalCodewords: 172, ecPerBlock: 18, g1Blocks: 2, g1Data: 68, g2Blocks: 0, g2Data: 0 },
    { totalCodewords: 196, ecPerBlock: 20, g1Blocks: 2, g1Data: 78, g2Blocks: 0, g2Data: 0 },
    { totalCodewords: 242, ecPerBlock: 24, g1Blocks: 2, g1Data: 97, g2Blocks: 0, g2Data: 0 },
    { totalCodewords: 292, ecPerBlock: 30, g1Blocks: 2, g1Data: 116, g2Blocks: 0, g2Data: 0 },
    { totalCodewords: 346, ecPerBlock: 18, g1Blocks: 2, g1Data: 68, g2Blocks: 2, g2Data: 69 },
  ],
  M: [
    { totalCodewords: 26, ecPerBlock: 10, g1Blocks: 1, g1Data: 16, g2Blocks: 0, g2Data: 0 },
    { totalCodewords: 44, ecPerBlock: 16, g1Blocks: 1, g1Data: 28, g2Blocks: 0, g2Data: 0 },
    { totalCodewords: 70, ecPerBlock: 26, g1Blocks: 1, g1Data: 44, g2Blocks: 0, g2Data: 0 },
    { totalCodewords: 100, ecPerBlock: 18, g1Blocks: 2, g1Data: 32, g2Blocks: 0, g2Data: 0 },
    { totalCodewords: 134, ecPerBlock: 24, g1Blocks: 2, g1Data: 43, g2Blocks: 0, g2Data: 0 },
    { totalCodewords: 172, ecPerBlock: 16, g1Blocks: 4, g1Data: 27, g2Blocks: 0, g2Data: 0 },
    { totalCodewords: 196, ecPerBlock: 18, g1Blocks: 4, g1Data: 31, g2Blocks: 0, g2Data: 0 },
    { totalCodewords: 242, ecPerBlock: 22, g1Blocks: 2, g1Data: 38, g2Blocks: 2, g2Data: 39 },
    { totalCodewords: 292, ecPerBlock: 22, g1Blocks: 3, g1Data: 36, g2Blocks: 2, g2Data: 37 },
    { totalCodewords: 346, ecPerBlock: 26, g1Blocks: 4, g1Data: 43, g2Blocks: 1, g2Data: 44 },
  ],
  Q: [
    { totalCodewords: 26, ecPerBlock: 13, g1Blocks: 1, g1Data: 13, g2Blocks: 0, g2Data: 0 },
    { totalCodewords: 44, ecPerBlock: 22, g1Blocks: 1, g1Data: 22, g2Blocks: 0, g2Data: 0 },
    { totalCodewords: 70, ecPerBlock: 18, g1Blocks: 2, g1Data: 17, g2Blocks: 0, g2Data: 0 },
    { totalCodewords: 100, ecPerBlock: 26, g1Blocks: 2, g1Data: 24, g2Blocks: 0, g2Data: 0 },
    { totalCodewords: 134, ecPerBlock: 18, g1Blocks: 2, g1Data: 15, g2Blocks: 2, g2Data: 16 },
    { totalCodewords: 172, ecPerBlock: 24, g1Blocks: 4, g1Data: 19, g2Blocks: 0, g2Data: 0 },
    { totalCodewords: 196, ecPerBlock: 18, g1Blocks: 2, g1Data: 14, g2Blocks: 4, g2Data: 15 },
    { totalCodewords: 242, ecPerBlock: 22, g1Blocks: 4, g1Data: 18, g2Blocks: 2, g2Data: 19 },
    { totalCodewords: 292, ecPerBlock: 20, g1Blocks: 4, g1Data: 16, g2Blocks: 4, g2Data: 17 },
    { totalCodewords: 346, ecPerBlock: 24, g1Blocks: 6, g1Data: 19, g2Blocks: 2, g2Data: 20 },
  ],
  H: [
    { totalCodewords: 26, ecPerBlock: 17, g1Blocks: 1, g1Data: 9, g2Blocks: 0, g2Data: 0 },
    { totalCodewords: 44, ecPerBlock: 28, g1Blocks: 1, g1Data: 16, g2Blocks: 0, g2Data: 0 },
    { totalCodewords: 70, ecPerBlock: 22, g1Blocks: 2, g1Data: 13, g2Blocks: 0, g2Data: 0 },
    { totalCodewords: 100, ecPerBlock: 16, g1Blocks: 4, g1Data: 9, g2Blocks: 0, g2Data: 0 },
    { totalCodewords: 134, ecPerBlock: 22, g1Blocks: 2, g1Data: 11, g2Blocks: 2, g2Data: 12 },
    { totalCodewords: 172, ecPerBlock: 28, g1Blocks: 4, g1Data: 15, g2Blocks: 0, g2Data: 0 },
    { totalCodewords: 196, ecPerBlock: 26, g1Blocks: 4, g1Data: 13, g2Blocks: 1, g2Data: 14 },
    { totalCodewords: 242, ecPerBlock: 26, g1Blocks: 4, g1Data: 14, g2Blocks: 2, g2Data: 15 },
    { totalCodewords: 292, ecPerBlock: 24, g1Blocks: 4, g1Data: 12, g2Blocks: 4, g2Data: 13 },
    { totalCodewords: 346, ecPerBlock: 28, g1Blocks: 6, g1Data: 15, g2Blocks: 2, g2Data: 16 },
  ],
};

const ALIGNMENT_PATTERN_LOCATIONS: number[][] = [
  [], // V1
  [6, 18], // V2
  [6, 22], // V3
  [6, 26], // V4
  [6, 30], // V5
  [6, 34], // V6
  [6, 22, 38], // V7
  [6, 24, 42], // V8
  [6, 26, 46], // V9
  [6, 28, 50], // V10
];

const FORMAT_BITS: number[] = [
  // L: 01, M: 00, Q: 11, H: 10
  // Index: (level << 3) | mask
  // M (00):
  0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0,
  // L (01):
  0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976,
  // H (10):
  0x1689, 0x13be, 0x1ce7, 0x19d0, 0x0762, 0x0255, 0x0d0c, 0x083b,
  // Q (11):
  0x355f, 0x3068, 0x3f31, 0x3a06, 0x24b4, 0x2183, 0x2eda, 0x2bed,
];

function getFormatInfo(level: QrErrorCorrectionLevel, mask: number): number {
  let levelIdx = 0;
  if (level === "M") levelIdx = 0;
  else if (level === "L") levelIdx = 1;
  else if (level === "H") levelIdx = 2;
  else if (level === "Q") levelIdx = 3;
  return FORMAT_BITS[(levelIdx << 3) | mask];
}

/**
 * Generates the QR code boolean matrix for the given string data.
 * Returns a 2D boolean array where true = black module, false = white module.
 */
export function generateQrMatrix(
  data: string,
  level: QrErrorCorrectionLevel = "M"
): boolean[][] {
  const encoder = new TextEncoder();
  const utf8Bytes = encoder.encode(data);

  // Find minimum version that fits data
  let version = 1;
  let tableEntry: VersionTableEntry | null = null;
  for (let v = 1; v <= 10; v++) {
    const entry = EC_TABLE[level][v - 1];
    const totalDataCapacity =
      entry.g1Blocks * entry.g1Data + entry.g2Blocks * entry.g2Data;
    // 8-bit byte mode overhead: 4 bits mode + (v <= 9 ? 8 : 16) bits char count
    const countBits = v <= 9 ? 8 : 16;
    const requiredBits = 4 + countBits + utf8Bytes.length * 8;
    if (requiredBits <= totalDataCapacity * 8) {
      version = v;
      tableEntry = entry;
      break;
    }
  }

  if (!tableEntry) {
    throw new Error(`Data too long for QR code generation (up to version 10 supported)`);
  }

  const totalDataBytes =
    tableEntry.g1Blocks * tableEntry.g1Data +
    tableEntry.g2Blocks * tableEntry.g2Data;

  // Encode data bits
  const bitArray: number[] = [];
  function pushBits(val: number, len: number) {
    for (let i = len - 1; i >= 0; i--) {
      bitArray.push((val >> i) & 1);
    }
  }

  // 1. Mode indicator: 0100 for Byte Mode
  pushBits(0b0100, 4);

  // 2. Character count indicator
  const charCountBits = version <= 9 ? 8 : 16;
  pushBits(utf8Bytes.length, charCountBits);

  // 3. Data bytes
  for (const b of utf8Bytes) {
    pushBits(b, 8);
  }

  // 4. Terminator (up to 4 zeroes)
  const maxDataBits = totalDataBytes * 8;
  const termLen = Math.min(4, maxDataBits - bitArray.length);
  pushBits(0, termLen);

  // 5. Pad to multiple of 8
  while (bitArray.length % 8 !== 0) {
    bitArray.push(0);
  }

  // 6. Pad bytes 0xEC and 0x11
  const dataBytes = new Uint8Array(totalDataBytes);
  let byteIdx = 0;
  for (let i = 0; i < bitArray.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) {
      b = (b << 1) | bitArray[i + j];
    }
    dataBytes[byteIdx++] = b;
  }

  let pad = 0xec;
  while (byteIdx < totalDataBytes) {
    dataBytes[byteIdx++] = pad;
    pad = pad === 0xec ? 0x11 : 0xec;
  }

  // 7. Error Correction Codewords computation
  const blocks: { data: Uint8Array; ec: Uint8Array }[] = [];
  let offset = 0;

  for (let i = 0; i < tableEntry.g1Blocks; i++) {
    const blockData = dataBytes.slice(offset, offset + tableEntry.g1Data);
    offset += tableEntry.g1Data;
    const ec = rsComputeRemainder(blockData, tableEntry.ecPerBlock);
    blocks.push({ data: blockData, ec });
  }

  for (let i = 0; i < tableEntry.g2Blocks; i++) {
    const blockData = dataBytes.slice(offset, offset + tableEntry.g2Data);
    offset += tableEntry.g2Data;
    const ec = rsComputeRemainder(blockData, tableEntry.ecPerBlock);
    blocks.push({ data: blockData, ec });
  }

  // 8. Interleave data and EC codewords
  const finalCodewords: number[] = [];
  const maxDataLen = Math.max(tableEntry.g1Data, tableEntry.g2Data);

  for (let i = 0; i < maxDataLen; i++) {
    for (const b of blocks) {
      if (i < b.data.length) {
        finalCodewords.push(b.data[i]);
      }
    }
  }

  for (let i = 0; i < tableEntry.ecPerBlock; i++) {
    for (const b of blocks) {
      finalCodewords.push(b.ec[i]);
    }
  }

  // Matrix size: (17 + 4 * version)
  const size = 17 + 4 * version;
  const matrix: (boolean | null)[][] = Array.from({ length: size }, () =>
    Array(size).fill(null)
  );
  const isFunction: boolean[][] = Array.from({ length: size }, () =>
    Array(size).fill(false)
  );

  function setModule(r: number, c: number, val: boolean, func = false) {
    matrix[r][c] = val;
    if (func) isFunction[r][c] = true;
  }

  // 9. Place Finder Patterns & Separators
  function placeFinder(row: number, col: number) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const nr = row + r;
        const nc = col + c;
        if (nr >= 0 && nr < size && nc >= 0 && nc < size) {
          if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
            const isDark =
              r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4);
            setModule(nr, nc, isDark, true);
          } else {
            // White separator
            setModule(nr, nc, false, true);
          }
        }
      }
    }
  }

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // 10. Place Alignment Patterns
  const alignCoords = ALIGNMENT_PATTERN_LOCATIONS[version - 1];
  for (const r of alignCoords) {
    for (const c of alignCoords) {
      if (matrix[r][c] !== null && isFunction[r][c]) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const isDark =
            Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0);
          setModule(r + dr, c + dc, isDark, true);
        }
      }
    }
  }

  // 11. Timing Patterns
  for (let i = 8; i < size - 8; i++) {
    if (matrix[6][i] === null) setModule(6, i, i % 2 === 0, true);
    if (matrix[i][6] === null) setModule(i, 6, i % 2 === 0, true);
  }

  // 12. Dark Module
  setModule(4 * version + 9, 8, true, true);

  // Reserve format info areas
  for (let i = 0; i <= 8; i++) {
    if (matrix[8][i] === null) setModule(8, i, false, true);
    if (matrix[i][8] === null) setModule(i, 8, false, true);
  }
  for (let i = size - 8; i < size; i++) {
    if (matrix[8][i] === null) setModule(8, i, false, true);
    if (matrix[i][8] === null) setModule(i, 8, false, true);
  }

  // 13. Place Data Codewords (Zig-Zag)
  const finalBits: number[] = [];
  for (const cw of finalCodewords) {
    for (let i = 7; i >= 0; i--) {
      finalBits.push((cw >> i) & 1);
    }
  }

  let bitIdx = 0;
  let goingUp = true;

  for (let rightCol = size - 1; rightCol > 0; rightCol -= 2) {
    if (rightCol === 6) rightCol--; // Skip vertical timing pattern column

    for (let vert = 0; vert < size; vert++) {
      const r = goingUp ? size - 1 - vert : vert;
      for (let c = rightCol; c >= rightCol - 1; c--) {
        if (!isFunction[r][c]) {
          const bitVal = bitIdx < finalBits.length ? finalBits[bitIdx++] === 1 : false;
          matrix[r][c] = bitVal;
        }
      }
    }
    goingUp = !goingUp;
  }

  // 14. Apply Best Mask Pattern
  function isMaskCondition(mask: number, r: number, c: number): boolean {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return false;
    }
  }

  let bestMask = 0;
  let minPenalty = Number.MAX_SAFE_INTEGER;
  let bestMatrix: boolean[][] = [];

  for (let mask = 0; mask < 8; mask++) {
    const candidate: boolean[][] = Array.from({ length: size }, () =>
      Array(size).fill(false)
    );

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (isFunction[r][c]) {
          candidate[r][c] = matrix[r][c] === true;
        } else {
          const orig = matrix[r][c] === true;
          const invert = isMaskCondition(mask, r, c);
          candidate[r][c] = invert ? !orig : orig;
        }
      }
    }

    // Apply format info bits for this mask
    const fmt = getFormatInfo(level, mask);
    for (let i = 0; i < 15; i++) {
      const bit = ((fmt >> i) & 1) === 1;
      // Top-left finder area
      if (i < 6) candidate[8][i] = bit;
      else if (i < 8) candidate[8][i + 1] = bit;
      else if (i === 8) candidate[7][8] = bit;
      else candidate[14 - i][8] = bit;

      // Split format info around top-right and bottom-left
      if (i < 8) candidate[size - 1 - i][8] = bit;
      else candidate[8][size - 15 + i] = bit;
    }

    // Evaluate penalty score
    let penalty = 0;

    // N1: 5+ consecutive same color in row/col
    for (let r = 0; r < size; r++) {
      let count = 1;
      for (let c = 1; c < size; c++) {
        if (candidate[r][c] === candidate[r][c - 1]) {
          count++;
        } else {
          if (count >= 5) penalty += 3 + (count - 5);
          count = 1;
        }
      }
      if (count >= 5) penalty += 3 + (count - 5);
    }

    for (let c = 0; c < size; c++) {
      let count = 1;
      for (let r = 1; r < size; r++) {
        if (candidate[r][c] === candidate[r - 1][c]) {
          count++;
        } else {
          if (count >= 5) penalty += 3 + (count - 5);
          count = 1;
        }
      }
      if (count >= 5) penalty += 3 + (count - 5);
    }

    // N2: 2x2 blocks of same color
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const val = candidate[r][c];
        if (
          candidate[r + 1][c] === val &&
          candidate[r][c + 1] === val &&
          candidate[r + 1][c + 1] === val
        ) {
          penalty += 3;
        }
      }
    }

    if (penalty < minPenalty) {
      minPenalty = penalty;
      bestMask = mask;
      bestMatrix = candidate;
    }
  }

  // Ensure bestMatrix is not empty
  if (bestMatrix.length === 0) {
    bestMatrix = matrix.map((row) => row.map((m) => m === true));
  }

  return bestMatrix;
}

/**
 * Generates an SVG string representation of the QR code.
 */
export function generateQrSvg(data: string, options?: QrSvgOptions): string {
  const size = options?.size ?? 256;
  const margin = options?.margin ?? 4;
  const fgColor = options?.fgColor ?? "#000000";
  const bgColor = options?.bgColor ?? "#ffffff";
  const level = options?.level ?? "M";
  const title = options?.title ?? "Stellar Payment QR Code";

  const matrix = generateQrMatrix(data, level);
  const matrixSize = matrix.length;
  const totalModules = matrixSize + margin * 2;

  let pathData = "";
  for (let r = 0; r < matrixSize; r++) {
    for (let c = 0; c < matrixSize; c++) {
      if (matrix[r][c]) {
        const x = c + margin;
        const y = r + margin;
        pathData += `M${x},${y}h1v1h-1z `;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalModules} ${totalModules}" width="${size}" height="${size}" shape-rendering="crispEdges" role="img" aria-label="${title}"><title>${title}</title><rect width="${totalModules}" height="${totalModules}" fill="${bgColor}"/><path d="${pathData.trim()}" fill="${fgColor}"/></svg>`;
}
