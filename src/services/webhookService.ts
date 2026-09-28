import { WebhookPayload, WebhookSignature } from '../types/webhookTypes';
import { verifySignature } from '../utils/cryptoUtils';

/**
 * Verifies the authenticity of a webhook signature.
 * @param payload - The webhook payload to verify.
 * @param signature - The signature to verify against.
 * @returns A boolean indicating whether the signature is valid.
 */
export const verifyWebhookSignature = (
  payload: WebhookPayload,
  signature: WebhookSignature
): boolean => {
  return verifySignature(payload, signature);
};
