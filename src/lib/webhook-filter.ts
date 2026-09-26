// SPDX-License-Identifier: MIT

/**
 * Decide whether a webhook subscribed to `storedEvents` (the raw JSON string
 * from the `events` column) should receive a given event type.
 *
 * An empty events array means "subscribed to everything" — this lets an
 * integrator register a webhook once and receive all events without having
 * to list every event type up front.
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