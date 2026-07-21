"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { AudioLines, CircleUserRound, Plus, Radio, ShieldCheck } from "lucide-react";
import type { PublicUser } from "@/lib/auth-store";

interface AdminConsoleProps {
  initialUsers: PublicUser[];
  currentUserId: string;
  csrfToken: string;
}

function formatTime(value: number | undefined): string {
  if (!value) return "尚未登录";
  return new Date(value).toISOString().replace("T", " ").slice(0, 16);
}

async function readError(response: Response): Promise<string> {
  const payload: unknown = await response.json().catch(() => null);
  if (typeof payload === "object" && payload !== null) {
    const error = (payload as Record<string, unknown>).error;
    if (
      typeof error === "object" &&
      error !== null &&
      typeof (error as Record<string, unknown>).message === "string"
    ) {
      return (error as { message: string }).message;
    }
  }
  return "后台操作失败，请稍后重试。";
}

export function AdminConsole({ initialUsers, currentUserId, csrfToken }: AdminConsoleProps) {
  const [users, setUsers] = useState(initialUsers);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const totals = useMemo(
    () => ({
      active: users.filter((user) => user.enabled).length,
      calls: users.reduce((sum, user) => sum + user.usage.realtimeConnections, 0),
      replies: users.reduce((sum, user) => sum + user.usage.replies, 0),
    }),
    [users],
  );

  const createAccount = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({
          username: form.get("username"),
          displayName: form.get("displayName"),
          password: form.get("password"),
          role: form.get("role"),
        }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const payload = (await response.json()) as { user: PublicUser };
      setUsers((current) => [...current, payload.user]);
      formElement.reset();
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "创建用户失败。");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleUser = async (user: PublicUser) => {
    setErrorMessage(null);
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({ id: user.id, enabled: !user.enabled }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const payload = (await response.json()) as { user: PublicUser };
      setUsers((current) =>
        current.map((candidate) => (candidate.id === payload.user.id ? payload.user : candidate)),
      );
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "更新用户失败。");
    }
  };

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <div className="auth-brand">
          <span className="brand-mark"><AudioLines size={18} /></span>
          <div><strong>声场后台</strong><small>ADMIN CONSOLE</small></div>
        </div>
        <Link className="admin-back" href="/"><Radio size={16} />返回语音对话</Link>
      </header>

      <section className="admin-content">
        <div className="admin-heading">
          <span className="eyebrow">OPERATIONS</span>
          <h1>用户与用量</h1>
          <p>账号停用后，现有会话会在下一次接口请求时立即失效。</p>
        </div>

        <div className="metric-grid">
          <article><span>启用账号</span><strong>{totals.active}</strong></article>
          <article><span>语音连接</span><strong>{totals.calls}</strong></article>
          <article><span>模型回复</span><strong>{totals.replies}</strong></article>
        </div>

        <div className="admin-grid">
          <section className="admin-panel">
            <div className="panel-title"><Plus size={17} /><h2>创建账号</h2></div>
            <form className="admin-form" onSubmit={createAccount}>
              <label><span>用户名</span><input name="username" minLength={3} maxLength={32} required /></label>
              <label><span>显示名称</span><input name="displayName" maxLength={40} required /></label>
              <label><span>初始密码</span><input name="password" type="password" minLength={10} maxLength={128} required /></label>
              <label>
                <span>角色</span>
                <select name="role" defaultValue="user">
                  <option value="user">普通用户</option>
                  <option value="admin">管理员</option>
                </select>
              </label>
              {errorMessage && <p className="form-error" role="alert">{errorMessage}</p>}
              <button className="start-button admin-create" type="submit" disabled={submitting}>
                <Plus size={17} />{submitting ? "创建中…" : "创建账号"}
              </button>
            </form>
          </section>

          <section className="admin-panel users-panel">
            <div className="panel-title"><ShieldCheck size={17} /><h2>账号列表</h2></div>
            <div className="user-list">
              {users.map((user) => (
                <article className="user-row" key={user.id}>
                  <div className="user-avatar"><CircleUserRound size={22} /></div>
                  <div className="user-identity">
                    <strong>{user.displayName}</strong>
                    <span>
                      @{user.username} · {user.role === "admin"
                        ? "管理员"
                        : user.accountType === "guest"
                          ? "自动访客"
                          : "普通用户"}
                    </span>
                  </div>
                  <div className="user-usage">
                    <span>{user.usage.realtimeConnections} 次连接</span>
                    <span>{user.usage.replies} 次回复</span>
                    <small>{formatTime(user.lastLoginAt)}</small>
                  </div>
                  <button
                    type="button"
                    className={user.enabled ? "user-toggle is-enabled" : "user-toggle"}
                    disabled={user.id === currentUserId}
                    onClick={() => void toggleUser(user)}
                  >
                    {user.enabled ? "已启用" : "已停用"}
                  </button>
                </article>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
