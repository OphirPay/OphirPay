// src/app/api/keys/route.ts

import { PrismaClient } from '@prisma/client';
import { validateKeyRotation, API_KEY_OVERLAP_WINDOW_DAYS } from '@/lib/api-auth';

const prisma = new PrismaClient();

// ... existing routes ...

// Rotate API Key
app.post('/rotate', async (req, res) => {
  const { apiKeyId, overlapDays = API_KEY_OVERLAP_WINDOW_DAYS } = req.body;
  const currentKey = await prisma.apiKey.findUnique({
    where: { id: apiKeyId }
  });

  if (!currentKey) {
    return res.status(404).json({ error: 'API key not found' });
  }

  // Generate new key with same scopes
  const newKey = await generateApiKey(currentKey.scopes);

  // Set up rotation relationship
  await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: {
      rotatedToId: newKey.id,
      overlapExpires: new Date(Date.now() + overlapDays * 24 * 60 * 60 * 1000)
    }
  });

  // Log rotation event
  await prisma.apiKeyRequestLog.create({
    data: {
      apiKeyId: currentKey.id,
      action: 'rotation',
      metadata: { rotatedToKeyId: newKey.id, overlapDays }
    }
  });

  return res.json({ success: true, newKey });
});

// Cancel Rotation
app.post('/cancel-rotation', async (req, res) => {
  const { apiKeyId } = req.body;
  const currentKey = await prisma.apiKey.findUnique({
    where: { id: apiKeyId }
  });

  if (!currentKey || !currentKey.rotatedToId) {
    return res.status(400).json({ error: 'No active rotation found' });
  }

  await prisma.apiKey.update({
    where: { id: apiKeyId },
    data: { rotatedToId: null, overlapExpires: null }
  });

  await prisma.apiKeyRequestLog.create({
    data: {
      apiKeyId: currentKey.id,
      action: 'rotation_cancelled'
    }
  });

  return res.json({ success: true });
});

// Check Key Status
app.get('/:keyId/status', async (req, res) => {
  const { keyId } = req.params;
  const key = await prisma.apiKey.findUnique({
    where: { id: keyId }
  });

  if (!key) {
    return res.status(404).json({ error: 'API key not found' });
  }

  return res.json({
    active: isKeyActive(key),
    rejectionReason: getKeyRejectionReason(key),
    rotationStatus: key.rotatedToId ? 'active' : null
  });
});