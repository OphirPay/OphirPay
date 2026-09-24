import { Asset, Keypair } from '@stellar/stellar-sdk';
import { annotateAssetWithTrust } from '../../src/lib/assets';

describe('asset trust annotation', () => {
  const account = Keypair.random();
  const asset = new Asset('USDC', 'GA5Z...'); // placeholder issuer

  it('returns trust status for an account', async () => {
    const annotated = await annotateAssetWithTrust(account.publicKey(), asset);
    expect(annotated).toHaveProperty('trustStatus');
    // In a sandbox environment the status will be 'none'
    expect(['none', 'authorized', 'frozen', 'authorized_to_maintain_liabilities']).toContain(
      annotated.trustStatus
    );
  });
});
