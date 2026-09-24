import type { NextApiRequest, NextApiResponse } from 'next';
import { buildTrustlineTx } from '../../../lib/trustline';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).end('Method Not Allowed');
  }

  const { sourceSecret, destinationPublic, assetCode, assetIssuer, limit } =
    req.body;

  if (!sourceSecret || !destinationPublic || !assetCode || !assetIssuer) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const { Asset } = await import('@stellar/stellar-sdk');
    const asset = new Asset(assetCode, assetIssuer);
    const xdr = await buildTrustlineTx(
      sourceSecret,
      destinationPublic,
      asset,
      limit
    );
    return res.status(200).json({ xdr });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
}
