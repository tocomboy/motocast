import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getBrowserSupabase } from "@/lib/supabase/browser";

import { InviteManager } from "./invite-manager";

vi.mock("@/lib/supabase/browser", () => ({
  getBrowserSupabase: vi.fn(),
}));

const syntheticToken = "test-invite-token-000000000000000000000000";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("InviteManager", () => {
  it("creates the seven-day invite and exposes its visible copy action", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ invite_token: syntheticToken, expires_at: "2026-09-23T00:00:00.000Z" }],
      error: null,
    });
    vi.mocked(getBrowserSupabase).mockReturnValue({ rpc } as never);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("window", { location: { origin: "https://example.test" } });

    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<InviteManager />);
    });

    const createButton = renderer.root.findByProps({ className: "primary-button" });
    expect(createButton.children).toEqual(["초대 링크 생성"]);

    await act(async () => createButton.props.onClick());

    expect(rpc).toHaveBeenCalledWith("create_invite", { valid_for: "7 days" });
    const copyButton = renderer.root.findByProps({ className: "ghost-button dark" });
    expect(copyButton.children).toEqual(["복사"]);
    await act(async () => copyButton.props.onClick());
    expect(writeText).toHaveBeenCalledWith(`https://example.test/invite#${syntheticToken}`);
    await act(async () => renderer.unmount());
  });
});
