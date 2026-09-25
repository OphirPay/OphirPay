#!/usr/bin/env python3
"""Append the WebhookDeadLetter model to prisma/schema.prisma (idempotent)."""
import pathlib, sys, re

p = pathlib.Path('prisma/schema.prisma')
src = p.read_text()

MODEL = '''
/// A webhook delivery that exhausted its retry budget.
/// Retains the payload, the last response code and the failure reason so the
/// subscriber can fix their endpoint and the operator can bulk-redeliver.
model WebhookDeadLetter {
  id               String    @id @default(cuid())
  webhookId        String
  deliveryId       String    @unique
  eventId          String
  payload          String
  attempts         Int       @default(0)
  lastResponseCode Int?
  lastErrorMessage String?
  failureReason    String?
  failedAt         DateTime  @default(now())
  replayedAt       DateTime?
  replayDeliveryId String?
  alertNotifiedAt  DateTime?

  @@index([webhookId, failedAt])
  @@index([replayedAt])
  @@map("webhook_dead_letters")
}
'''

if 'model WebhookDeadLetter' in src:
    print('model already present, skipping')
    sys.exit(0)

if not src.endswith('\n'):
    src += '\n'
src += MODEL
p.write_text(src)
print('appended WebhookDeadLetter model')
