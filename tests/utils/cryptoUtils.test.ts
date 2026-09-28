import { verifySignature } from '../../src/utils/cryptoUtils';
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

describe('verifySignature', () => {
  it('should return true for a valid signature', () => {
    expect(verifySignature(mockPayload, mockSignature)).toBe(true);
  });

  it('should return false for an invalid signature', () => {
    expect(verifySignature(mockPayload, mockInvalidSignature)).toBe(false);
  });
});
