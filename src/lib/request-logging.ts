import { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';
import { logger } from '../utils/logger';

/**
 * Logs basic request information before passing control to the handler.
 *
 * @param handler The original API handler.
 */
export function withRequestLogging(handler: NextApiHandler) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const start = Date.now();
    logger.info(`API ${req.method} ${req.url}`);
    try {
      await handler(req, res);
    } finally {
      const duration = Date.now() - start;
      logger.info(`API ${req.method} ${req.url} completed in ${duration}ms`);
    }
  };
}
