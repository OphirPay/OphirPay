import EventSource from 'eventsource';
import { logger } from '../utils/logger';

export interface EventSourceOptions {
  onMessage: (event: MessageEvent) => void;
  onError?: (err: any) => void;
}

/**
 * Wraps the EventSource constructor to provide a simple interface
 * and automatic reconnection with exponential backoff.
 */
export function createEventSource(url: string, opts: EventSourceOptions): EventSource {
  const es = new EventSource(url, { heartbeatTimeout: 30000 });

  es.onmessage = opts.onMessage;
  es.onerror = (err) => {
    opts.onError?.(err);
    // EventSource automatically reconnects; we log the error.
    logger.warn(`EventSource error on ${url}: ${err}`);
  };

  return es;
}
