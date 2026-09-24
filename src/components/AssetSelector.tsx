import React, { useEffect, useState } from 'react';
import { Asset } from '@stellar/stellar-sdk';
import { annotateAssetWithTrust } from '../lib/assets';
import { buildTrustlineTx } from '../lib/trustline';

interface AssetSelectorProps {
  accountId: string;
  selectedAsset: Asset | null;
  onSelect: (asset: Asset) => void;
  onCreateTrustline: (xdr: string) => void;
}

export const AssetSelector: React.FC<AssetSelectorProps> = ({
  accountId,
  selectedAsset,
  onSelect,
  onCreateTrustline,
}) => {
  const [trustStatus, setTrustStatus] = useState<
    'none' | 'authorized' | 'frozen' | 'authorized_to_maintain_liabilities' | undefined
  >(undefined);

  useEffect(() => {
    if (!selectedAsset) return;
    annotateAssetWithTrust(accountId, selectedAsset).then((annotated) => {
      setTrustStatus(annotated.trustStatus);
    });
  }, [accountId, selectedAsset]);

  const handleCreateTrustline = async () => {
    if (!selectedAsset) return;
    const xdr = await buildTrustlineTx(
      process.env.NEXT_PUBLIC_SOURCE_SECRET!,
      accountId,
      selectedAsset
    );
    onCreateTrustline(xdr);
  };

  return (
    <div>
      {/* Existing asset selection UI omitted for brevity */}
      {selectedAsset && trustStatus === 'none' && (
        <div className="trustline-warning">
          <p>
            This account does not trust {selectedAsset.getCode()} issued by{' '}
            {selectedAsset.getIssuer()}. A trustline is required to receive this asset.
          </p>
          <button onClick={handleCreateTrustline}>Create Trustline</button>
        </div>
      )}
      {selectedAsset && trustStatus === 'frozen' && (
        <div className="trustline-frozen">
          <p>
            The trustline for {selectedAsset.getCode()} is frozen. You cannot receive this
            asset until the issuer unfreezes it.
          </p>
        </div>
      )}
      {selectedAsset && trustStatus === 'authorized' && (
        <div className="trustline-ok">
          <p>Trustline established. You can receive {selectedAsset.getCode()}.</p>
        </div>
      )}
    </div>
  );
};
