import express from 'express';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';
import {
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
  CLIENT_IP_HEADER_ORDER,
  buildCSPHeader,
} from './lib/security-policy';

/**
 * Middleware to attach a request‑id header.
 */
const requestIdMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const requestId = uuidv4();
  res.setHeader('X-Request-Id', requestId);
  next();
};

/**
 * Rate‑limit middleware using the constants from `security-policy`.
 */
const limiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX_REQUESTS,
  keyGenerator: (req) => {
    for (const header of CLIENT_IP_HEADER_ORDER) {
      const value = req.headers[header];
      if (typeof value === 'string') return value;
    }
    return req.ip;
  },
});

/**
 * CSP middleware that injects a nonce and sets the header.
 */
const cspMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const nonce = uuidv4().replace(/-/g, '');
  res.setHeader('Content-Security-Policy', buildCSPHeader(nonce));
  res.setHeader('X-Content-Security-Policy-Nonce', nonce);
  next();
};

const app = express();

app.use(requestIdMiddleware);
app.use(limiter);
app.use(cspMiddleware);

/* ... rest of the proxy implementation ... */

export default app;
