import { Asset } from '@stellar/stellar-sdk';
import { checkTrustlineStatus } from './trustline';

/**
 * Extend the Asset type with trustline status for UI usage.
 */
export interface AssetWithTrust extends Asset {
  trustStatus?: 'none' | 'authorized' | 'frozen' | 'authorized_to_maintain_liabilities';
}

/**
 * Fetch an asset and annotate it with the trustline status for a given account.
 *
 * @param {string} accountId - Public key of the account.
 * @param {Asset} asset - Asset to annotate.
 * @returns {Promise<AssetWithTrust>}
 */
export async function annotateAssetWithTrust(
  accountId: string,
  asset: Asset
): Promise<AssetWithTrust> {
  const status = await checkTrustlineStatus(accountId, asset);
  return { ...asset, trustStatus: status };
}
