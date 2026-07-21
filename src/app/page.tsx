import { redirect } from "next/navigation";
import { VoiceConsole } from "@/components/voice-console";
import { getCurrentSession } from "@/lib/auth-session";

export default async function Home() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  return <VoiceConsole user={session.user} csrfToken={session.csrfToken} />;
}
