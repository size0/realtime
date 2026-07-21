import { redirect } from "next/navigation";
import { AdminConsole } from "@/components/admin-console";
import { getCurrentSession } from "@/lib/auth-session";
import { listUsers } from "@/lib/auth-store";

export default async function AdminPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.user.role !== "admin") redirect("/");
  return (
    <AdminConsole
      initialUsers={await listUsers()}
      currentUserId={session.user.id}
      csrfToken={session.csrfToken}
    />
  );
}
