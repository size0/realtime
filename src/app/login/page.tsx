import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getCurrentSession } from "@/lib/auth-session";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ admin?: string }>;
}) {
  const query = await searchParams;
  if (query.admin !== "1") redirect("/");
  const session = await getCurrentSession();
  if (session?.user.role === "admin") redirect("/admin");
  return <LoginForm />;
}
