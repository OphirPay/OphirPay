/**
 * Custom error type used by API handlers to signal
 * specific HTTP status codes and messages.
 */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}
