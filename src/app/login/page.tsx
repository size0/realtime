import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getCurrentSession } from "@/lib/auth-session";

export default async function LoginPage() {
  const session = await getCurrentSession();
  if (session && session.user.accountType !== "guest") redirect("/");
  return <LoginForm />;
}
