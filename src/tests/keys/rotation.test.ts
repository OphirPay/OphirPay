// src/tests/keys/rotation.test.ts

import { expect, test } from '@jest/globals';
import { prisma } from '@/lib/prisma';
import { generateApiKey, validateKeyRotation } from '@/lib/api-auth';

describe('API Key Rotation', () => {
  test('should create rotation relationship with overlap window', async () => {
    const key = await generateApiKey(['read:data']);
    const newKey = await generateApiKey(['read:data']);

    await prisma.apiKey.update({
      where: { id: key.id },
      data: {
        rotatedToId: newKey.id,
        overlapExpires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      }
    });

    const updatedKey = await prisma.apiKey.findUnique({
      where: { id: key.id }
    });

    expect(updatedKey.rotatedToId).toBe(newKey.id);
    expect(updatedKey.overlapExpires).toBeDefined();
    expect(validateKeyRotation(updatedKey, newKey)).toBe(true);
  });

  test('should reject old key after overlap window', async () => {
    const key = await generateApiKey(['read:data']);
    const expiredDate = new Date(Date.now() - 1);

    await prisma.apiKey.update({
      where: { id: key.id },
      data: {
        overlapExpires: expiredDate
      }
    });

    const updatedKey = await prisma.apiKey.findUnique({
      where: { id: key.id }
    });

    expect(validateKeyRotation(updatedKey, null as any)).toBe(false);
  });

  test('should allow explicit rotation cancellation', async () => {
    const key = await generateApiKey(['read:data']);
    const newKey = await generateApiKey(['read:data']);

    await prisma.apiKey.update({
      where: { id: key.id },
      data: {
        rotatedToId: newKey.id,
        overlapExpires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      }
    });

    await prisma.apiKey.update({
      where: { id: key.id },
      data: {
        rotatedToId: null,
        overlapExpires: null
      }
    });

    const updatedKey = await prisma.apiKey.findUnique({
      where: { id: key.id }
    });

    expect(updatedKey.rotatedToId).toBeNull();
    expect(updatedKey.overlapExpires).toBeNull();
  });
});