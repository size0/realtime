import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getUserById, type PublicUser, type UserRole } from "@/lib/auth-store";

export const SESSION_COOKIE_NAME = "voice_session";
const SESSION_VERSION = 1;
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

interface SessionPayload {
  version: typeof SESSION_VERSION;
  userId: string;
  username: string;
  role: UserRole;
  csrfToken: string;
  expiresAt: number;
}

export interface AuthSession {
  user: PublicUser;
  csrfToken: string;
}

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must contain at least 32 characters.");
  }
  return secret;
}

function signature(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function readCookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...valueParts] = part.trim().split("=");
    if (key === name) return decodeURIComponent(valueParts.join("="));
  }
  return null;
}

function verifyToken(token: string): SessionPayload | null {
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const encoded = token.slice(0, separator);
  const providedSignature = token.slice(separator + 1);
  if (!safeEqual(signature(encoded), providedSignature)) return null;

  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const payload = parsed as Record<string, unknown>;
    if (
      payload.version !== SESSION_VERSION ||
      typeof payload.userId !== "string" ||
      typeof payload.username !== "string" ||
      (payload.role !== "admin" && payload.role !== "user") ||
      typeof payload.csrfToken !== "string" ||
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt <= Date.now()
    ) {
      return null;
    }
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

async function resolveSession(token: string | null): Promise<AuthSession | null> {
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const user = await getUserById(payload.userId);
  if (
    !user ||
    !user.enabled ||
    user.username !== payload.username ||
    user.role !== payload.role
  ) {
    return null;
  }
  return { user, csrfToken: payload.csrfToken };
}

export function createSession(user: PublicUser): { token: string; csrfToken: string } {
  const payload: SessionPayload = {
    version: SESSION_VERSION,
    userId: user.id,
    username: user.username,
    role: user.role,
    csrfToken: randomBytes(24).toString("base64url"),
    expiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return { token: `${encoded}.${signature(encoded)}`, csrfToken: payload.csrfToken };
}

export function sessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`;
}

export function expiredSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

export async function getRequestSession(request: Request): Promise<AuthSession | null> {
  return resolveSession(readCookieValue(request.headers.get("cookie"), SESSION_COOKIE_NAME));
}

export async function getCurrentSession(): Promise<AuthSession | null> {
  const cookieStore = await cookies();
  return resolveSession(cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null);
}

export function validCsrfToken(session: AuthSession, provided: string | null): boolean {
  return typeof provided === "string" && safeEqual(session.csrfToken, provided);
}
