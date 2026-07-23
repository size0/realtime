const WECHAT_VERIFICATION = "ZzyPeQRIUydBxi3B";

export const dynamic = "force-static";

export function GET(): Response {
  return new Response(WECHAT_VERIFICATION, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
