import { NextApiResponse } from 'next';

/**
 * Standardized JSON response helpers.
 */
export function jsonSuccess<T>(res: NextApiResponse, data: T, status = 200) {
  res.status(status).json({ data });
}

export function jsonError(res: NextApiResponse, message: string, status = 400) {
  res.status(status).json({ error: message });
}
