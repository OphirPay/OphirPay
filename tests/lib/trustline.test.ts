import { Asset, Keypair } from '@stellar/stellar-sdk';
import { buildTrustlineTx } from '../../src/lib/trustline';

describe('trustline helper', () => {
  const source = Keypair.random();
  const destination = Keypair.random();
  const asset = new Asset('USDC', 'GA5Z...'); // placeholder issuer

  it('creates a valid XDR for a trustline operation', async () => {
    const xdr = await buildTrustlineTx(
      source.secret(),
      destination.publicKey(),
      asset,
      '1000'
    );
    expect(typeof xdr).toBe('string');
    expect(xdr.length).toBeGreaterThan(0);
  });
});
