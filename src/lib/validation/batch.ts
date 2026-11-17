import { z } from 'zod';

/**
 * Schema for individual recipient in a batch
 */
export const recipientSchema = z.object({
  address: z.string().min(1, "Recipient address is required"),
  amount: z.string().min(1, "Amount is required"),
  assetCode: z.string().optional(),
});

/**
 * Schema for batch payment requests
 * Enforces a maximum of 100 recipients per request
 */
export const batchSchema = z.object({
  recipients: z
    .array(recipientSchema)
    .min(1, "At least one recipient is required")
    .max(100, "Maximum 100 recipients allowed per batch request"),
  memo: z.string().max(28).optional(),
});

export type BatchRequest = z.infer<typeof batchSchema>;
