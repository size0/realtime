const WINDOW_MS = 10 * 60 * 1000;
const MAX_CONNECTION_ATTEMPTS = 6;
const MAX_REPLY_ATTEMPTS = 60;
const MAX_LOGIN_ATTEMPTS = 10;
const MAX_ADMIN_MUTATIONS = 30;
const GUEST_CREATION_WINDOW_MS = 60 * 60 * 1000;
const MAX_GUEST_CREATIONS = 5;

type Bucket = { count: number; resetAt: number };
const connectionBuckets = new Map<string, Bucket>();
const replyBuckets = new Map<string, Bucket>();
const loginBuckets = new Map<string, Bucket>();
const adminMutationBuckets = new Map<string, Bucket>();
const guestCreationBuckets = new Map<string, Bucket>();

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

function checkRateLimit(
  buckets: Map<string, Bucket>,
  identifier: string,
  maxAttempts: number,
  now: number,
  windowMs = WINDOW_MS,
): RateLimitResult {
  const current = buckets.get(identifier);
  if (!current || current.resetAt <= now) {
    buckets.set(identifier, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (current.count >= maxAttempts) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function checkConnectionRateLimit(
  identifier: string,
  now = Date.now(),
): RateLimitResult {
  return checkRateLimit(connectionBuckets, identifier, MAX_CONNECTION_ATTEMPTS, now);
}

export function checkReplyRateLimit(identifier: string, now = Date.now()): RateLimitResult {
  return checkRateLimit(replyBuckets, identifier, MAX_REPLY_ATTEMPTS, now);
}

export function checkLoginRateLimit(identifier: string, now = Date.now()): RateLimitResult {
  return checkRateLimit(loginBuckets, identifier, MAX_LOGIN_ATTEMPTS, now);
}

export function checkAdminMutationRateLimit(
  identifier: string,
  now = Date.now(),
): RateLimitResult {
  return checkRateLimit(adminMutationBuckets, identifier, MAX_ADMIN_MUTATIONS, now);
}

export function checkGuestCreationRateLimit(
  identifier: string,
  now = Date.now(),
): RateLimitResult {
  return checkRateLimit(
    guestCreationBuckets,
    identifier,
    MAX_GUEST_CREATIONS,
    now,
    GUEST_CREATION_WINDOW_MS,
  );
}

export function resetConnectionRateLimitForTests(): void {
  connectionBuckets.clear();
}

export function resetLoginRateLimitForTests(): void {
  loginBuckets.clear();
}

export function resetAdminMutationRateLimitForTests(): void {
  adminMutationBuckets.clear();
}

export function resetReplyRateLimitForTests(): void {
  replyBuckets.clear();
}

export function resetGuestCreationRateLimitForTests(): void {
  guestCreationBuckets.clear();
}
