// SPDX-License-Identifier: MIT

/**
 * Webhook Event Subscription Filtering
 *
 * Evaluates whether a registered webhook's subscription list matches a candidate event.
 * An empty event list denotes a wildcard subscription (subscribed to all events).
 */

export function isSubscribedToEvent(storedEvents: string, eventType: string): boolean {
  let events: unknown;
  try {
    events = JSON.parse(storedEvents);
  } catch {
    return false;
  }

  if (!Array.isArray(events)) return false;
  if (events.length === 0) return true; // empty = subscribed to all events

  return events.includes(eventType);
}
