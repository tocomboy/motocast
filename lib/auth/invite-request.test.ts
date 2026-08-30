import { describe, expect, it } from "vitest";

import { isTrustedInviteAcceptanceRequest } from "./invite-request";

function request(headers: HeadersInit) {
  return new Request("https://motocast.example/api/invites/accept", {
    method: "POST",
    headers,
    body: "{}",
  });
}

describe("invitation acceptance request boundary", () => {
  it("accepts same-origin JSON browser requests", () => {
    expect(isTrustedInviteAcceptanceRequest(request({
      "content-type": "application/json; charset=utf-8",
      origin: "https://motocast.example",
      "sec-fetch-site": "same-origin",
    }))).toBe(true);
  });

  it.each<Record<string, string>>([
    { "content-type": "text/plain", origin: "https://motocast.example" },
    { "content-type": "application/json", origin: "https://attacker.example" },
    { "content-type": "application/json" },
    { "content-type": "application/json", origin: "https://motocast.example", "sec-fetch-site": "cross-site" },
  ])("rejects cross-site or non-JSON requests without accepting a token %#", (headers) => {
    expect(isTrustedInviteAcceptanceRequest(request(headers))).toBe(false);
  });
});
