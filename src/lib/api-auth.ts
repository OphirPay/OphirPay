// src/lib/api-auth.ts

export const API_KEY_OVERLAP_WINDOW_DAYS = 7;
export const API_KEY_ROTATION_MINIMUM_DURATION = 1;

export function validateKeyRotation(apiKey: ApiKey, newKey: ApiKey): boolean {
  if (!apiKey.overlapExpires) return false;
  if (new Date(apiKey.overlapExpires) < new Date()) return false;
  return true;
}

export function isKeyActive(apiKey: ApiKey): boolean {
  if (apiKey.revokedAt) return false;
  if (apiKey.overlapExpires && new Date(apiKey.overlapExpires) < new Date()) return false;
  return true;
}

export function getKeyRejectionReason(apiKey: ApiKey): string | null {
  if (!apiKey.revokedAt && !apiKey.overlapExpires) return null;
  if (apiKey.revokedAt) return 'Key was explicitly revoked';
  if (apiKey.overlapExpires && new Date(apiKey.overlapExpires) < new Date()) {
    return 'Key expired during rotation overlap window';
  }
  return null;
}