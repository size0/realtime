"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { LockKeyhole, MoonStar } from "lucide-react";

export function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const message =
          typeof payload === "object" &&
          payload !== null &&
          typeof (payload as { error?: { message?: unknown } }).error?.message === "string"
            ? (payload as { error: { message: string } }).error.message
            : "登录失败，请稍后重试。";
        throw new Error(message);
      }
      window.location.assign("/admin");
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error ? error.message : "登录失败，请稍后重试。",
      );
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-shell">
      <div className="ambient-grid" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
      <section className="auth-card" aria-labelledby="login-title">
        <div className="auth-brand">
          <span className="brand-mark"><MoonStar size={19} /></span>
          <div><strong>树洞后台</strong><small>ADMIN ACCESS</small></div>
        </div>
        <div className="auth-heading">
          <span className="eyebrow">SECURE ACCESS</span>
          <h1 id="login-title">管理员登录</h1>
          <p>这是隐藏的运营入口。普通用户会自动生成匿名账号，不会看到此页面。</p>
        </div>
        <form className="auth-form" onSubmit={submit}>
          <label>
            <span>用户名</span>
            <input
              name="username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              minLength={3}
              maxLength={32}
              required
            />
          </label>
          <label>
            <span>密码</span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={10}
              maxLength={128}
              required
            />
          </label>
          {errorMessage && <p className="form-error" role="alert">{errorMessage}</p>}
          <button className="start-button auth-submit" type="submit" disabled={submitting}>
            <LockKeyhole size={18} />
            <span>{submitting ? "正在登录…" : "安全登录"}</span>
          </button>
        </form>
        <Link className="auth-footnote auth-admin-link" href="/">返回树洞</Link>
        <p className="auth-footnote">登录会话保存在签名的 HttpOnly Cookie 中</p>
      </section>
    </main>
  );
}
