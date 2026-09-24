import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { csrfToken } from 'next-csrf';
import { jsonError } from './api-response';

/**
 * CSRF protection wrapper.
 *
 * Expects a CSRF token to be present in the `X-CSRF-Token` header
 * and validates it against the session cookie.
 *
 * @param handler The original API handler.
 */
export function withCsrf(handler: NextApiHandler) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const token = req.headers['x-csrf-token'] as string | undefined;
    if (!token) {
      return jsonError(res, 'Missing CSRF token', 403);
    }

    try {
      await csrfToken.verify(token, req);
      await handler(req, res);
    } catch (err) {
      console.error('CSRF verification failed', err);
      return jsonError(res, 'Invalid CSRF token', 403);
    }
  };
}
