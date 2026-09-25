import React, { useEffect, useState } from "react";
import { Asset } from "../lib/assets";
import { resolveAssetMetadata, AssetMetadata } from "../lib/assetMetadata";

interface AssetSelectorProps {
  assets: Asset[];
  selected: Asset;
  onChange: (a: Asset) => void;
}

export const AssetSelector: React.FC<AssetSelectorProps> = ({
  assets,
  selected,
  onChange,
}) => {
  const [metadataMap, setMetadataMap] = useState<Record<string, AssetMetadata>>({});

  useEffect(() => {
    // Resolve metadata for all assets in parallel
    const promises = assets.map(async (a) => {
      const meta = await resolveAssetMetadata(a);
      return [a.code + a.issuer, meta] as [string, AssetMetadata];
    });

    Promise.all(promises).then((entries) => {
      const map: Record<string, AssetMetadata> = {};
      entries.forEach(([key, meta]) => {
        map[key] = meta;
      });
      setMetadataMap(map);
    });
  }, [assets]);

  const getDisplay = (a: Asset) => {
    const meta = metadataMap[a.code + a.issuer];
    if (meta?.name) {
      return `${meta.name} (${a.code})`;
    }
    return `${a.code} (${a.issuer})`;
  };

  return (
    <select
      value={selected.code + selected.issuer}
      onChange={(e) => {
        const codeIssuer = e.target.value;
        const asset = assets.find((a) => codeIssuer === a.code + a.issuer);
        if (asset) onChange(asset);
      }}
      className="border rounded p-2"
    >
      {assets.map((a) => (
        <option key={a.code + a.issuer} value={a.code + a.issuer}>
          {getDisplay(a)}
        </option>
      ))}
    </select>
  );
};
