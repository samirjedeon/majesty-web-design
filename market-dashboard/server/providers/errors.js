// Throw this from a provider when the upstream says "slow down"; the data
// service then waits at least retryAfterMs before calling that provider again.
export class RateLimitError extends Error {
  constructor(message, retryAfterMs) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}
