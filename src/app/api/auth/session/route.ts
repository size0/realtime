import { getRequestSession } from "@/lib/auth-session";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const session = await getRequestSession(request);
  if (!session) {
    return Response.json({ authenticated: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(
    { authenticated: true, user: session.user, csrfToken: session.csrfToken },
    { headers: { "Cache-Control": "no-store" } },
  );
}
