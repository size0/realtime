/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VoiceConsole } from "@/components/voice-console";
import type { PublicUser } from "@/lib/auth-store";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href} {...props}>{children}</a>,
}));

vi.mock("@/hooks/use-split-voice", () => ({
  useSplitVoice: () => ({
    callStatus: "idle",
    messages: [],
    errorMessage: null,
    isMuted: false,
    isActive: false,
    audioLevel: 0,
    remainingSeconds: 0,
    quotaExhausted: true,
    connect: vi.fn(),
    endCall: vi.fn(),
    toggleMute: vi.fn(),
    clearTranscript: vi.fn(),
  }),
}));

afterEach(() => cleanup());

const guestUser: PublicUser = {
  id: "guest-1",
  username: "guest_abc",
  displayName: "树洞旅人",
  role: "user",
  accountType: "guest",
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
  lastLoginAt: 1,
  usage: {
    replies: 0,
    realtimeConnections: 0,
  },
  dailyUsage: {
    date: "2026-07-26",
    replies: 0,
    realtimeConnections: 0,
  },
};

const wechatUser: PublicUser = {
  ...guestUser,
  id: "wechat-1",
  username: "wechat_abc",
  accountType: "wechat",
};

describe("VoiceConsole WeChat guest prompt", () => {
  it("lets an in-WeChat guest bind WeChat instead of asking them to open WeChat again", () => {
    render(
      <VoiceConsole
        user={guestUser}
        csrfToken="csrf"
        defaultCompanion="breeze"
        isWechat
        canBindWechat
      />,
    );

    expect(screen.getByRole("link", { name: "绑定微信" })).toHaveAttribute(
      "href",
      "/api/auth/wechat/start?returnTo=/",
    );
    expect(screen.getByText("你已经在微信里，点下方按钮绑定微信，授权后每天可以继续聊 10 分钟。")).toBeVisible();
    expect(screen.getByRole("link", { name: "绑定微信继续聊" })).toHaveAttribute(
      "href",
      "/api/auth/wechat/start?returnTo=/",
    );
  });

  it("does not show a dead bind button when WeChat OAuth is not configured", () => {
    render(
      <VoiceConsole
        user={guestUser}
        csrfToken="csrf"
        defaultCompanion="breeze"
        isWechat
      />,
    );

    expect(screen.getByText("你已经在微信里，微信绑定暂未开启；请稍后再试。")).toBeVisible();
    expect(screen.getByRole("button", { name: "微信绑定暂未开启" })).toBeDisabled();
  });

  it("keeps WeChat bind errors visible for an already signed-in guest", () => {
    render(
      <VoiceConsole
        user={guestUser}
        csrfToken="csrf"
        defaultCompanion="breeze"
        isWechat
        canBindWechat
        wechatError="expired"
      />,
    );

    expect(screen.getByText("上次绑定没成功：这次微信授权已经过期，请重新绑定。")).toBeVisible();
    expect(screen.getByRole("link", { name: "绑定微信继续聊" })).toHaveAttribute(
      "href",
      "/api/auth/wechat/start?returnTo=/",
    );
  });

  it("shows a clear bound state for WeChat accounts", () => {
    render(
      <VoiceConsole
        user={wechatUser}
        csrfToken="csrf"
        defaultCompanion="breeze"
        isWechat
        canBindWechat
      />,
    );

    expect(screen.getByText("微信已绑定")).toBeVisible();
    expect(screen.queryByRole("link", { name: "绑定微信" })).not.toBeInTheDocument();
  });
});
