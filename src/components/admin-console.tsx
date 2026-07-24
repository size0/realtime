"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  BookOpenText,
  CircleUserRound,
  Clock3,
  Eye,
  Gauge,
  LayoutDashboard,
  MessageCircleMore,
  MoonStar,
  Settings2,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import type { PublicUser } from "@/lib/auth-store";
import type {
  ConversationDetail,
  ConversationSummary,
} from "@/lib/conversation-store";
import type {
  ProductSettings,
  PromptVersion,
} from "@/lib/product-admin";
import { COMPANION_OPTIONS } from "@/types/product";

type AdminTab = "overview" | "users" | "conversations" | "settings" | "audit";

interface AuditLog {
  id: string;
  adminId: string;
  action: string;
  targetId: string | null;
  reason: string;
  createdAt: number;
}

interface AdminConsoleProps {
  initialUsers: PublicUser[];
  initialConversations: ConversationSummary[];
  initialAuditLogs: AuditLog[];
  initialSettings: ProductSettings;
  initialPromptVersions: PromptVersion[];
  currentUserId: string;
  csrfToken: string;
}

const TAB_OPTIONS: ReadonlyArray<{
  value: AdminTab;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { value: "overview", label: "概览", icon: LayoutDashboard },
  { value: "users", label: "用户", icon: Users },
  { value: "conversations", label: "对话", icon: MessageCircleMore },
  { value: "settings", label: "产品设置", icon: Settings2 },
  { value: "audit", label: "提示词与审计", icon: ShieldCheck },
];

const RISK_COPY = {
  normal: "普通",
  elevated: "需关注",
  crisis: "高风险",
};

function formatTime(value: number | undefined): string {
  if (!value) return "尚未登录";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
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

export function AdminConsole({
  initialUsers,
  initialConversations,
  initialAuditLogs,
  initialSettings,
  initialPromptVersions,
  currentUserId,
  csrfToken,
}: AdminConsoleProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");
  const [users, setUsers] = useState(initialUsers);
  const [auditLogs, setAuditLogs] = useState(initialAuditLogs);
  const [settings, setSettings] = useState(initialSettings);
  const [promptVersions, setPromptVersions] = useState(initialPromptVersions);
  const [promptDraft, setPromptDraft] = useState(
    initialPromptVersions.find((version) => version.status === "active")?.content ?? "",
  );
  const [pendingConversation, setPendingConversation] =
    useState<ConversationSummary | null>(null);
  const [conversationDetail, setConversationDetail] =
    useState<ConversationDetail | null>(null);
  const [reason, setReason] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);

  const totals = useMemo(
    () => ({
      activeUsers: users.filter((user) => user.enabled).length,
      wechatUsers: users.filter((user) => user.accountType === "wechat").length,
      calls: users.reduce((sum, user) => sum + user.usage.realtimeConnections, 0),
      replies: users.reduce((sum, user) => sum + user.usage.replies, 0),
      highRisk: initialConversations.filter((item) => item.riskLevel !== "normal").length,
    }),
    [initialConversations, users],
  );

  const userName = (userId: string) =>
    users.find((user) => user.id === userId)?.displayName ?? "匿名用户";

  const toggleUser = async (user: PublicUser) => {
    setErrorMessage(null);
    try {
      const response = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ id: user.id, enabled: !user.enabled }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const payload = (await response.json()) as { user: PublicUser };
      setUsers((current) =>
        current.map((candidate) =>
          candidate.id === payload.user.id ? payload.user : candidate,
        ),
      );
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "更新用户失败。");
    }
  };

  const openConversation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pendingConversation || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await fetch(
        `/api/admin/conversations/${pendingConversation.id}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
          },
          body: JSON.stringify({ reason }),
        },
      );
      if (!response.ok) throw new Error(await readError(response));
      const payload = (await response.json()) as {
        conversation: ConversationDetail;
      };
      setConversationDetail(payload.conversation);
      setAuditLogs((current) => [
        {
          id: crypto.randomUUID(),
          adminId: currentUserId,
          action: "conversation.read",
          targetId: pendingConversation.id,
          reason,
          createdAt: Date.now(),
        },
        ...current,
      ]);
      setPendingConversation(null);
      setReason("");
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "查看对话失败。");
    } finally {
      setSubmitting(false);
    }
  };

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingSettings) return;
    setSavingSettings(true);
    setErrorMessage(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({
          guestTrialSeconds: Number(form.get("guestTrialSeconds")),
          wechatDailySeconds: Number(form.get("wechatDailySeconds")),
          vadSilenceMs: Number(form.get("vadSilenceMs")),
          defaultCompanion: form.get("defaultCompanion"),
        }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const payload = (await response.json()) as { settings: ProductSettings };
      setSettings(payload.settings);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "保存产品设置失败。");
    } finally {
      setSavingSettings(false);
    }
  };

  const savePromptDraft = async () => {
    if (savingPrompt) return;
    setSavingPrompt(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/admin/prompts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ content: promptDraft }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const payload = (await response.json()) as { version: PromptVersion };
      setPromptVersions((current) => [payload.version, ...current]);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "保存提示词草稿失败。");
    } finally {
      setSavingPrompt(false);
    }
  };

  const publishPrompt = async (id: string) => {
    if (savingPrompt) return;
    setSavingPrompt(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/admin/prompts", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({ id }),
      });
      if (!response.ok) throw new Error(await readError(response));
      const payload = (await response.json()) as { version: PromptVersion };
      setPromptVersions((current) =>
        current.map((version) =>
          version.id === payload.version.id
            ? payload.version
            : version.status === "active"
              ? { ...version, status: "archived" }
              : version,
        ),
      );
      setPromptDraft(payload.version.content);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "发布提示词失败。");
    } finally {
      setSavingPrompt(false);
    }
  };

  return (
    <main className="ops-shell">
      <aside className="ops-sidebar">
        <div className="ops-brand">
          <span><MoonStar size={18} /></span>
          <div><strong>树洞后台</strong><small>OPERATIONS</small></div>
        </div>
        <nav aria-label="后台模块">
          {TAB_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.value}
                type="button"
                className={activeTab === option.value ? "is-active" : ""}
                onClick={() => setActiveTab(option.value)}
              >
                <Icon size={17} />
                {option.label}
              </button>
            );
          })}
        </nav>
        <Link href="/" className="ops-back"><ArrowLeft size={16} /> 返回树洞</Link>
      </aside>

      <section className="ops-content">
        <header className="ops-header">
          <div>
            <span>VOICE.XDW0.CN</span>
            <h1>{TAB_OPTIONS.find((item) => item.value === activeTab)?.label}</h1>
          </div>
          <div className="ops-health"><Activity size={15} /> 服务运行中</div>
        </header>

        {errorMessage && <p className="ops-error" role="alert">{errorMessage}</p>}

        {activeTab === "overview" && (
          <>
            <div className="ops-metrics">
              <article><Users size={18} /><span>启用用户</span><strong>{totals.activeUsers}</strong><small>微信 {totals.wechatUsers} 人</small></article>
              <article><Clock3 size={18} /><span>语音连接</span><strong>{totals.calls}</strong><small>累计连接次数</small></article>
              <article><MessageCircleMore size={18} /><span>模型回复</span><strong>{totals.replies}</strong><small>仅统计成功回复</small></article>
              <article><ShieldCheck size={18} /><span>风险会话</span><strong>{totals.highRisk}</strong><small>不代表人工实时介入</small></article>
            </div>
            <section className="ops-panel">
              <div className="ops-panel-title">
                <div><Gauge size={18} /><h2>产品运行原则</h2></div>
              </div>
              <div className="ops-notes">
                <p>音频不落盘，最终字幕逐条加密保存，30天后自动清理。</p>
                <p>普通倾诉使用便宜模型，复杂问题与风险内容自动转交强模型。</p>
                <p>管理员查看文字前必须填写原因，每一次查看都会写入审计记录。</p>
              </div>
            </section>
          </>
        )}

        {activeTab === "users" && (
          <section className="ops-panel">
            <div className="ops-panel-title">
              <div><Users size={18} /><h2>用户与账号</h2></div>
              <span>{users.length} 个账号</span>
            </div>
            <div className="ops-table">
              {users.map((user) => (
                <article className="ops-user-row" key={user.id}>
                  <span className="ops-avatar"><CircleUserRound size={22} /></span>
                  <div><strong>{user.displayName}</strong><small>{user.accountType === "wechat" ? "微信匿名账号" : user.accountType === "guest" ? "访客" : "后台账号"}</small></div>
                  <div><span>最近登录</span><small>{formatTime(user.lastLoginAt)}</small></div>
                  <div><span>连接 / 回复</span><small>{user.usage.realtimeConnections} / {user.usage.replies}</small></div>
                  <button
                    type="button"
                    className={user.enabled ? "is-enabled" : ""}
                    disabled={user.id === currentUserId}
                    onClick={() => void toggleUser(user)}
                  >
                    {user.enabled ? "已启用" : "已停用"}
                  </button>
                </article>
              ))}
            </div>
          </section>
        )}

        {activeTab === "conversations" && (
          <section className="ops-panel">
            <div className="ops-panel-title">
              <div><MessageCircleMore size={18} /><h2>最近30天对话</h2></div>
              <span>{initialConversations.length} 段</span>
            </div>
            <div className="ops-table">
              {initialConversations.length === 0 ? (
                <div className="ops-empty">还没有同步到服务器的最终字幕</div>
              ) : initialConversations.map((conversation) => (
                <article className="ops-conversation-row" key={conversation.id}>
                  <div><strong>{userName(conversation.userId)}</strong><small>{formatTime(conversation.createdAt)}</small></div>
                  <div><span>消息</span><small>{conversation.messageCount} 条</small></div>
                  <div><span>状态</span><small>{conversation.status}</small></div>
                  <em data-risk={conversation.riskLevel}>{RISK_COPY[conversation.riskLevel]}</em>
                  <button type="button" onClick={() => setPendingConversation(conversation)}>
                    <Eye size={15} /> 填写原因后查看
                  </button>
                </article>
              ))}
            </div>
          </section>
        )}

        {activeTab === "settings" && (
          <>
            <section className="ops-panel">
              <div className="ops-panel-title"><div><Settings2 size={18} /><h2>陪伴角色</h2></div><span>生产白名单</span></div>
              <div className="ops-companions">
                {COMPANION_OPTIONS.map((option) => (
                  <article key={option.value}>
                    <strong>{option.name}</strong>
                    <p>{option.description}</p>
                    <small>开场：{option.greeting}</small>
                  </article>
                ))}
              </div>
            </section>
            <form className="ops-panel" onSubmit={saveSettings}>
              <div className="ops-panel-title"><div><Gauge size={18} /><h2>当前生产参数</h2></div></div>
              <div className="ops-settings-form">
                <label><span>静音断句（毫秒）</span><input name="vadSilenceMs" type="number" min={500} max={3000} defaultValue={settings.vadSilenceMs} /></label>
                <label><span>访客体验（秒）</span><input name="guestTrialSeconds" type="number" min={30} max={600} defaultValue={settings.guestTrialSeconds} /></label>
                <label><span>微信每日额度（秒）</span><input name="wechatDailySeconds" type="number" min={60} max={3600} defaultValue={settings.wechatDailySeconds} /></label>
                <label><span>默认陪伴角色</span><select name="defaultCompanion" defaultValue={settings.defaultCompanion}>{COMPANION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.name}</option>)}</select></label>
              </div>
              <button className="ops-save-button" type="submit" disabled={savingSettings}>{savingSettings ? "保存中…" : "保存产品参数"}</button>
              <p className="ops-secret-note">API Key、AppSecret、加密密钥和供应商地址只存在于服务器环境变量，后台不会显示。</p>
              <p className="ops-secret-note">额度会立即生效；VAD 断句时长需语音 Worker 重启后生效。</p>
            </form>
          </>
        )}

        {activeTab === "audit" && (
          <>
            <section className="ops-panel">
              <div className="ops-panel-title"><div><BookOpenText size={18} /><h2>树洞陪伴提示词</h2></div><span>系统安全规则不可删除</span></div>
              <textarea className="ops-prompt-editor" value={promptDraft} onChange={(event) => setPromptDraft(event.target.value)} minLength={20} maxLength={4000} />
              <div className="ops-prompt-actions">
                <button type="button" onClick={() => void savePromptDraft()} disabled={savingPrompt}>保存草稿</button>
              </div>
              <div className="ops-prompt-versions">
                {promptVersions.map((version) => (
                  <article key={version.id}>
                    <div><strong>{version.status === "active" ? "当前生效" : version.status === "draft" ? "草稿" : "历史版本"}</strong><time>{formatTime(version.createdAt)}</time></div>
                    <p>{version.content}</p>
                    {version.status !== "active" && <button type="button" onClick={() => void publishPrompt(version.id)} disabled={savingPrompt}>{version.status === "archived" ? "回滚到此版本" : "发布此版本"}</button>}
                  </article>
                ))}
              </div>
            </section>
            <section className="ops-panel">
              <div className="ops-panel-title"><div><ShieldCheck size={18} /><h2>操作审计</h2></div><span>{auditLogs.length} 条</span></div>
              <div className="ops-audit-list">
                {auditLogs.length === 0 ? <div className="ops-empty">暂时没有敏感操作记录</div> : auditLogs.map((log) => (
                  <article key={log.id}>
                    <strong>{log.action === "conversation.read" ? "查看对话" : log.action}</strong>
                    <p>{log.reason}</p>
                    <time>{formatTime(log.createdAt)}</time>
                  </article>
                ))}
              </div>
            </section>
          </>
        )}
      </section>

      {pendingConversation && (
        <div className="ops-modal-backdrop" role="presentation">
          <form className="ops-modal" onSubmit={openConversation}>
            <button className="ops-modal-close" type="button" onClick={() => setPendingConversation(null)} aria-label="关闭"><X size={17} /></button>
            <Eye size={22} />
            <h2>查看加密对话</h2>
            <p>请说明本次查看目的。原因会与管理员、时间和会话ID一起写入审计记录。</p>
            <label>
              <span>查看原因</span>
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={2} maxLength={120} required placeholder="例如：处理用户主动反馈的问题" />
            </label>
            <button type="submit" disabled={submitting}>{submitting ? "正在解密…" : "确认并查看"}</button>
          </form>
        </div>
      )}

      {conversationDetail && (
        <div className="ops-modal-backdrop" role="presentation">
          <section className="ops-dialog-view">
            <button className="ops-modal-close" type="button" onClick={() => setConversationDetail(null)} aria-label="关闭"><X size={17} /></button>
            <header><div><span>{userName(conversationDetail.userId)}</span><h2>对话文字</h2></div><em data-risk={conversationDetail.riskLevel}>{RISK_COPY[conversationDetail.riskLevel]}</em></header>
            <div>
              {conversationDetail.messages.map((message) => (
                <article key={message.id} className={`role-${message.role}`}>
                  <span>{message.role === "user" ? "用户" : "树洞"}</span>
                  <p>{message.text}</p>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
