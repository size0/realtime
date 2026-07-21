import { GuestBootstrap } from "@/components/guest-bootstrap";
import { VoiceConsole } from "@/components/voice-console";
import { getCurrentSession } from "@/lib/auth-session";

export default async function Home() {
  const session = await getCurrentSession();
  if (!session) return <GuestBootstrap />;
  return <VoiceConsole user={session.user} csrfToken={session.csrfToken} />;
}
