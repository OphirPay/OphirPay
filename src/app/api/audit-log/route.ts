import { Request, Response } from 'express';
import { db } from '../../database';

// Function to fetch audit logs with cursor-based pagination
export const getAuditLogs = async (req: Request, res: Response) => {
  const { cursor, limit = 10, sort = 'createdAt', order = 'desc' } = req.query;

  // Validate limit
  const parsedLimit = Math.min(Math.max(Number(limit), 1), 100);

  // Build the query
  let query = db('audit_logs').orderBy(sort, order);

  // Apply cursor-based pagination
  if (cursor) {
    const cursorValue = Buffer.from(cursor, 'base64').toString('ascii');
    query = query.where(sort, order === 'desc' ? '<' : '>', cursorValue);
  }

  // Fetch the logs
  const logs = await query.limit(parsedLimit);

  // Prepare the response
  const nextCursor = logs.length > 0 ? Buffer.from(logs[logs.length - 1][sort]).toString('base64') : null;
  res.json({ logs, nextCursor });
};

// Add this route to your express app
app.get('/api/audit-log', getAuditLogs);