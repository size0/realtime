const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 6;

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function checkConnectionRateLimit(identifier: string, now = Date.now()): RateLimitResult {
  const current = buckets.get(identifier);
  if (!current || current.resetAt <= now) {
    buckets.set(identifier, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (current.count >= MAX_ATTEMPTS) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function resetConnectionRateLimitForTests(): void {
  buckets.clear();
}
