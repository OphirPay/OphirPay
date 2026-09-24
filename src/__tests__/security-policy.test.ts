import { CSP_DIRECTIVES, buildCSPHeader } from '../lib/security-policy';

describe('Security policy', () => {
  it('should expose a CSP directive object with the expected keys', () => {
    const expectedKeys = [
      'default-src',
      'script-src',
      'style-src',
      'img-src',
      'connect-src',
      'font-src',
      'object-src',
      'frame-ancestors',
      'base-uri',
      'form-action',
    ];
    expect(Object.keys(CSP_DIRECTIVES)).toEqual(expectedKeys);
  });

  it('should contain the correct connect-src hosts', () => {
    const connectSrc = CSP_DIRECTIVES['connect-src'];
    const expectedHosts = [
      "'self'",
      'https://horizon.stellar.org',
      'https://horizon-testnet.stellar.org',
      'https://rpc.stellar.org',
      'https://rpc-testnet.stellar.org',
      'https://rpc-futurenet.stellar.org',
    ];
    expect(connectSrc).toEqual(expectedHosts);
  });

  it('buildCSPHeader should replace the nonce placeholder', () => {
    const nonce = '123456';
    const header = buildCSPHeader(nonce);
    expect(header).toContain(`'nonce-${nonce}'`);
    // Ensure the placeholder is not present
    expect(header).not.toContain('<nonce>');
  });
});
