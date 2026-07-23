import { describe, expect, it } from "vitest";
import { GET } from "@/app/MP_verify_ZzyPeQRIUydBxi3B.txt/route";

describe("WeChat verification route", () => {
  it("returns the exact verification body without a trailing newline", async () => {
    const response = GET();
    const body = await response.arrayBuffer();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(new Uint8Array(body)).toEqual(
      new TextEncoder().encode("ZzyPeQRIUydBxi3B"),
    );
  });
});
