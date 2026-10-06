/** What actually goes to Resend for a sign-in email (Resend itself is replaced by a stand-in). */

import { afterEach, describe, expect, it, vi } from "vitest";

const sent: Array<Record<string, unknown>> = [];
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (msg: Record<string, unknown>) => {
        sent.push(msg);
        return { data: { id: "x" }, error: null };
      },
    };
  },
}));

afterEach(() => {
  sent.length = 0;
  delete process.env["RESEND_API_KEY"];
});

describe("sending the sign-in email", () => {
  it("sends the new template, the plain-text part and the inline logo, from login@postrun.app", async () => {
    process.env["RESEND_API_KEY"] = "re_test";
    const { sendSignInEmail } = await import("./email");
    await sendSignInEmail("hero@example.com", "https://app.postrun.app/login/confirm?token=abc", { at: new Date("2026-10-06T17:25:00Z"), device: "Chrome on macOS" });
    expect(sent).toHaveLength(1);
    const m = sent[0]!;
    expect(m["from"]).toBe("Postrun <login@postrun.app>");
    expect(m["to"]).toBe("hero@example.com");
    expect(m["subject"]).toBe("Sign in to Postrun");
    expect(m["html"]).toContain("Request details");
    expect(m["html"]).toContain("Chrome on macOS");
    expect(m["html"]).toContain('src="cid:postrun-logo"');
    expect(m["text"]).toContain("https://app.postrun.app/login/confirm?token=abc");
    const [logo] = m["attachments"] as Array<{ contentId: string; content: Buffer }>;
    expect(logo?.contentId).toBe("postrun-logo");
    expect(logo?.content.subarray(1, 4).toString()).toBe("PNG");
    expect((m["headers"] as Record<string, string>)["X-Entity-Ref-ID"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});
