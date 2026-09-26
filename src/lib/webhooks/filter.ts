// SPDX-License-Identifier: MIT
//
// Webhook event filtering — decides which subscribers receive an event.
//
// A webhook subscribes by storing a JSON array of event types in its `events`
// column. An empty array means "subscribed to everything", so an integrator
// can register once and receive all events without listing every type.

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
