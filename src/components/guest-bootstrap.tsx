"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AudioLines, LoaderCircle, RotateCcw } from "lucide-react";

async function readGuestError(response: Response): Promise<string> {
  const payload: unknown = await response.json().catch(() => null);
  if (typeof payload !== "object" || payload === null) {
    return "暂时无法进入语音空间，请稍后重试。";
  }
  const error = (payload as Record<string, unknown>).error;
  if (typeof error !== "object" || error === null) {
    return "暂时无法进入语音空间，请稍后重试。";
  }
  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" ? message : "暂时无法进入语音空间，请稍后重试。";
}

export function GuestBootstrap() {
  const startedRef = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const enter = useCallback(async () => {
    setErrorMessage(null);
    try {
      const response = await fetch("/api/auth/guest", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await readGuestError(response));
      window.location.replace("/");
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error ? error.message : "暂时无法进入语音空间，请稍后重试。",
      );
    }
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void enter();
  }, [enter]);

  return (
    <main className="auth-shell">
      <div className="ambient-grid" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
      <section className="auth-card" aria-labelledby="guest-title">
        <div className="auth-brand">
          <span className="brand-mark"><AudioLines size={19} strokeWidth={2.2} /></span>
          <div><strong>声场</strong><small>REALTIME VOICE</small></div>
        </div>
        <div className="auth-heading">
          <span className="eyebrow">INSTANT ACCESS</span>
          <h1 id="guest-title">正在准备你的声场</h1>
          <p>首次访问会自动生成访客账号，无需注册或填写密码。</p>
        </div>
        {errorMessage ? (
          <>
            <p className="form-error" role="alert">{errorMessage}</p>
            <button className="start-button auth-submit" type="button" onClick={() => void enter()}>
              <RotateCcw size={18} /><span>重新进入</span>
            </button>
          </>
        ) : (
          <div className="guest-loading" aria-live="polite">
            <LoaderCircle size={22} className="guest-spinner" />
            <span>正在自动登录…</span>
          </div>
        )}
        <Link className="auth-footnote auth-admin-link" href="/login">管理员或已有账号登录</Link>
      </section>
    </main>
  );
}
