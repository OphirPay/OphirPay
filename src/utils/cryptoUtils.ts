import { createHmac } from 'crypto';
import { WebhookPayload, WebhookSignature } from '../types/webhookTypes';

/**
 * Verifies a webhook signature.
 * @param payload - The webhook payload to verify.
 * @param signature - The signature to verify against.
 * @returns A boolean indicating whether the signature is valid.
 */
export const verifySignature = (
  payload: WebhookPayload,
  signature: WebhookSignature
): boolean => {
  const computedSignature = createHmac('sha256', process.env.WEBHOOK_SECRET!)
    .update(JSON.stringify(payload))
    .digest('hex');

  return computedSignature === signature;
};
