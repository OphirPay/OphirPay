import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { getSession } from 'next-auth/react';
import { ApiError } from './api-error';

/**
 * Options for the authentication wrapper.
 * - `required`: whether a session is mandatory (default true).
 * - `roles`: array of allowed user roles; if omitted all authenticated users are allowed.
 */
export interface AuthOptions {
  required?: boolean;
  roles?: string[];
}

/**
 * Context that is injected into the request by the auth wrapper.
 */
export interface AuthContext {
  user?: any;
}

/**
 * Wraps a Next.js API handler with authentication logic.
 *
 * The wrapper will:
 * 1. Retrieve the session via next-auth.
 * 2. Enforce the `required` flag and optional role checks.
 * 3. Attach the user object to `req.auth` for downstream handlers.
 * 4. Translate any `ApiError` thrown by the wrapped handler into a proper HTTP response.
 *
 * @param handler The original API handler.
 * @param options Optional authentication configuration.
 */
export function withAuth(handler: NextApiHandler, options: AuthOptions = { required: true }) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const session = await getSession({ req });

    if (!session && options.required) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Attach user to request for downstream usage
    (req as any).auth = { user: session?.user };

    // Role-based access control
    if (options.roles && session?.user?.role && !options.roles.includes(session.user.role)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof ApiError) {
        res.status(err.status).json({ error: err.message });
      } else {
        console.error(err);
        res.status(500).json({ error: 'Internal Server Error' });
      }
    }
  };
}
