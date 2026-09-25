// src/lib/keys-api.ts

export async function rotateKey(apiKeyId: string, overlapDays: number) {
  const response = await fetch('/api/keys/rotate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKeyId, overlapDays })
  });
  return response.json();
}

export async function cancelRotation(apiKeyId: string) {
  const response = await fetch('/api/keys/cancel-rotation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKeyId })
  });
  return response.json();
}

export async function getKeyStatus(keyId: string) {
  const response = await fetch(`/api/keys/${keyId}/status`);
  return response.json();
}