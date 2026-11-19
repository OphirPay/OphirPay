import { batchSchema } from '../batch';
import { describe, it, expect } from 'vitest';

describe('Batch Schema Validation', () => {
  const validRecipient = {
    address: 'GBVG2CPYST6Y...EXAMPLE',
    amount: '10.0',
  };

  it('should accept a batch with exactly 100 recipients', () => {
    const recipients = Array(100).fill(validRecipient);
    const result = batchSchema.safeParse({ recipients });
    
    expect(result.success).toBe(true);
  });

  it('should reject a batch with 101 recipients', () => {
    const recipients = Array(101).fill(validRecipient);
    const result = batchSchema.safeParse({ recipients });
    
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toBe('Maximum 100 recipients allowed per batch request');
    }
  });

  it('should reject an empty recipients array', () => {
    const result = batchSchema.safeParse({ recipients: [] });
    
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].message).toBe('At least one recipient is required');
    }
  });
});
