# Webhook Delivery E2E Coverage

The webhook delivery integration test starts a local receiver, records every
request body, returns a `500` on the first attempt, and returns `204` on the
retry. It asserts that the signed event reaches the receiver after retry and
that the transmitted payload contains a valid SHA-256 signature.

The receiver is isolated to the test process. The production URL guard remains
responsible for rejecting private destinations outside this controlled test.
