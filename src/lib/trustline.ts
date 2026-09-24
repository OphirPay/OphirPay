import { Server, TransactionBuilder, Operation, Asset, Keypair, Networks } from '@stellar/stellar-sdk';

/**
 * Build a trustline creation transaction for a non‑native asset.
 *
 * @param {string} sourceSecret - Secret key of the source account that will create the trustline.
 * @param {string} destinationPublic - Public key of the account that will receive the asset.
 * @param {Asset} asset - The asset to trust.
 * @param {string} [limit='1000000'] - Optional limit for the trustline. Defaults to a large number.
 * @returns {Promise<string>} XDR of the signed transaction ready to submit.
 *
 * The transaction is memo‑free, uses the base reserve, and is signed by the source account.
 */
export async function buildTrustlineTx(
  sourceSecret: string,
  destinationPublic: string,
  asset: Asset,
  limit: string = '1000000'
): Promise<string> {
  const sourceKeypair = Keypair.fromSecret(sourceSecret);
  const server = new Server(process.env.HORIZON_URL!);

  // Load the source account to get the current sequence number
  const sourceAccount = await server.loadAccount(sourceKeypair.publicKey());

  const tx = new TransactionBuilder(sourceAccount, {
    fee: await server.fetchBaseFee(),
    networkPassphrase: Networks.TESTNET, // Adjust if using mainnet
  })
    .addOperation(
      Operation.changeTrust({
        asset,
        limit,
      })
    )
    .setTimeout(180)
    .build();

  tx.sign(sourceKeypair);
  return tx.toXDR();
}

/**
 * Check the trustline status for a given account and asset.
 *
 * @param {string} accountId - Public key of the account to check.
 * @param {Asset} asset - Asset to check trustline for.
 * @returns {Promise<'none' | 'authorized' | 'frozen' | 'authorized_to_maintain_liabilities'>}
 */
export async function checkTrustlineStatus(
  accountId: string,
  asset: Asset
): Promise<
  'none' | 'authorized' | 'frozen' | 'authorized_to_maintain_liabilities'
> {
  const server = new Server(process.env.HORIZON_URL!);
  const account = await server.loadAccount(accountId);
  const trustline = account.balances.find(
    (b) => b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer()
  );

  if (!trustline) {
    return 'none';
  }

  if (trustline.limit === '0') {
    return 'none';
  }

  if (trustline.flags.authorized) {
    if (trustline.flags.frozen) {
      return 'frozen';
    }
    return 'authorized';
  }

  // If not authorized but flags exist
  if (trustline.flags.authorized_to_maintain_liabilities) {
    return 'authorized_to_maintain_liabilities';
  }

  return 'none';
}
