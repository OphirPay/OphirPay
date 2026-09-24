# Contributing to OphirPay

...

## End‑to‑End (E2E) Tests

The repository includes a Playwright test suite located in the `e2e/` directory.
Running the suite is straightforward, but there are a few important details to keep in mind.

### Prerequisites

1. **A running instance of the application**  
   The Playwright configuration **does not** start a web server automatically.  
   Before invoking the tests you must have the API/Dashboard server listening on a
   reachable URL. By default the tests will target `http://localhost:3000`, but you
   can override this with the `E2E_BASE_URL` environment variable:

   