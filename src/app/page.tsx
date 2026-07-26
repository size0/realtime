import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { GuestBootstrap } from "@/components/guest-bootstrap";
import { VoiceConsole } from "@/components/voice-console";
import { getCurrentSession } from "@/lib/auth-session";
import { isWechatOauthConfigured } from "@/lib/wechat-oauth";
import { getProductSettings } from "@/lib/product-admin";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ wechatError?: string }>;
}) {
  const session = await getCurrentSession();
  const requestHeaders = await headers();
  const isWechat = /MicroMessenger/i.test(requestHeaders.get("user-agent") ?? "");
  const canBindWechat = isWechatOauthConfigured();
  const query = await searchParams;
  if (session) {
    return (
      <VoiceConsole
        user={session.user}
        csrfToken={session.csrfToken}
        defaultCompanion={getProductSettings().defaultCompanion}
        isWechat={isWechat}
        canBindWechat={canBindWechat}
        wechatError={isWechat ? query.wechatError : undefined}
      />
    );
  }

  if (isWechat && canBindWechat && !query.wechatError) {
    redirect("/api/auth/wechat/start?returnTo=/");
  }
  return (
    <GuestBootstrap
      wechatError={isWechat ? query.wechatError : undefined}
      isWechat={isWechat}
    />
  );
}
