import { verifyWebhookSignature } from '../../src/services/webhookService';
import { WebhookPayload, WebhookSignature } from '../../src/types/webhookTypes';

const mockPayload: WebhookPayload = {
  id: '123',
  event: 'test',
  data: { key: 'value' }
};

const mockSignature: WebhookSignature = {
  signature: 'valid_signature'
};

const mockInvalidSignature: WebhookSignature = {
  signature: 'invalid_signature'
};

describe('verifyWebhookSignature', () => {
  it('should return true for a valid signature', () => {
    expect(verifyWebhookSignature(mockPayload, mockSignature)).toBe(true);
  });

  it('should return false for an invalid signature', () => {
    expect(verifyWebhookSignature(mockPayload, mockInvalidSignature)).toBe(false);
  });
});
