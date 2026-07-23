import { describe, expect, it } from "vitest";
import { splitForSpeech } from "@/lib/sentence-stream";

describe("sentence streaming", () => {
  it("keeps natural Chinese punctuation with each sentence", () => {
    expect(splitForSpeech("我在听。你可以慢慢说！不用着急。")).toEqual([
      "我在听。",
      "你可以慢慢说！",
      "不用着急。",
    ]);
  });

  it("splits long text at a nearby phrase boundary", () => {
    const text = `先说第一件事，${"慢慢来".repeat(80)}，最后再做决定。`;
    const segments = splitForSpeech(text, 80);
    expect(segments.length).toBeGreaterThan(2);
    expect(segments.every((segment) => segment.length <= 81)).toBe(true);
  });
});

