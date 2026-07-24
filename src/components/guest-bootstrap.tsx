"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Leaf, LoaderCircle, MoonStar, RotateCcw } from "lucide-react";

const WECHAT_ERROR_COPY: Record<string, string> = {
  state: "微信登录校验没有通过，请重新进入。",
  expired: "这次微信授权已经过期，请重新进入。",
  provider: "微信登录暂时没有完成，请稍后再试。",
};

async function readGuestError(response: Response): Promise<string> {
  const payload: unknown = await response.json().catch(() => null);
  if (typeof payload === "object" && payload !== null) {
    const error = (payload as Record<string, unknown>).error;
    if (typeof error === "object" && error !== null) {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === "string") return message;
    }
  }
  return "暂时无法进入树洞，请稍后重试。";
}

export function GuestBootstrap({
  wechatError,
  isWechat = false,
}: {
  wechatError?: string;
  isWechat?: boolean;
}) {
  const startedRef = useRef(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(
    wechatError ? WECHAT_ERROR_COPY[wechatError] ?? "微信登录暂时没有完成。" : null,
  );

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
        error instanceof Error ? error.message : "暂时无法进入树洞，请稍后重试。",
      );
    }
  }, []);

  useEffect(() => {
    if (wechatError || startedRef.current) return;
    startedRef.current = true;
    void enter();
  }, [enter, wechatError]);

  const retry = () => {
    if (isWechat && wechatError) {
      window.location.assign("/api/auth/wechat/start?returnTo=/");
      return;
    }
    void enter();
  };

  return (
    <main className="auth-shell">
      <div className="ambient-grid" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
      <section className="auth-card" aria-labelledby="guest-title">
        <div className="auth-brand">
          <span className="brand-mark"><MoonStar size={19} /></span>
          <div><strong>树洞</strong><small>听你慢慢说</small></div>
        </div>
        <div className="auth-heading">
          <span className="eyebrow">A QUIET PLACE FOR YOU</span>
          <h1 id="guest-title">正在为你留一盏灯</h1>
          <p>不需要注册，也不用填写资料。进入后会自动生成一个匿名树洞账号。</p>
        </div>
        {errorMessage ? (
          <>
            <p className="form-error" role="alert">{errorMessage}</p>
            <button className="start-button auth-submit" type="button" onClick={retry}>
              <RotateCcw size={18} /><span>重新进入</span>
            </button>
          </>
        ) : (
          <div className="guest-loading" aria-live="polite">
            <LoaderCircle size={22} className="guest-spinner" />
            <span>正在安静地准备…</span>
          </div>
        )}
        <p className="auth-footnote"><Leaf size={13} /> 不保存音频，文字会加密保存30天</p>
      </section>
    </main>
  );
}
