import crypto from 'crypto';

export function buildCsp(nonce?: string) {
  const scriptSrc = nonce
    ? `'self' 'nonce-${nonce}' 'wasm-unsafe-eval'`
    : `'self' 'unsafe-inline' 'wasm-unsafe-eval'`;
  return [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: https:`,
    `font-src 'self' data:`,
    `connect-src 'self'`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`
  ].join('; ');
}

export function getNonce() {
  return crypto.randomBytes(16).toString('base64');
}