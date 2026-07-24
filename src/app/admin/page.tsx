import { redirect } from "next/navigation";
import { AdminConsole } from "@/components/admin-console";
import { getCurrentSession } from "@/lib/auth-session";
import { listUsers } from "@/lib/auth-store";
import {
  listAdminAuditLogs,
  listAdminConversations,
} from "@/lib/conversation-store";
import {
  getProductSettings,
  listPromptVersions,
} from "@/lib/product-admin";

export default async function AdminPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login?admin=1");
  if (session.user.role !== "admin") redirect("/");
  return (
    <AdminConsole
      initialUsers={await listUsers()}
      initialConversations={listAdminConversations()}
      initialAuditLogs={listAdminAuditLogs()}
      initialSettings={getProductSettings()}
      initialPromptVersions={listPromptVersions()}
      currentUserId={session.user.id}
      csrfToken={session.csrfToken}
    />
  );
}
