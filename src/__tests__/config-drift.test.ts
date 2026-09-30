import { buildCsp } from '../proxy';

describe('CSP config drift', () => {
  it('production CSP does not contain unsafe-inline', () => {
    const nonce = 'testnonce';
    const csp = buildCsp(nonce);
    expect(csp).toContain(`'nonce-${nonce}'`);
    expect(csp).not.toContain(`'unsafe-inline'`);
    expect(csp).toContain(`'wasm-unsafe-eval'`);
  });

  it('development CSP allows unsafe-inline when nonce absent', () => {
    const csp = buildCsp();
    expect(csp).toContain(`'unsafe-inline'`);
  });
});