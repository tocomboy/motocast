import { describe, expect, it } from "vitest";

import { parseKmaItems } from "./kma-response";
import { weatherFailureKind } from "./weather-failure";

describe("parseKmaItems", () => {
  it("classifies malformed provider JSON as a KMA response failure", async () => {
    await expect(parseKmaItems(new Response("not-json"))).rejects.toThrow("KMA_INVALID_RESPONSE");
  });

  it.each(["null", "[]", '"unexpected"'])("classifies structurally invalid provider JSON %s", async (body) => {
    const error = await parseKmaItems(new Response(body)).catch((reason: unknown) => reason);
    expect(error).toEqual(new Error("KMA_INVALID_RESPONSE"));
    expect(weatherFailureKind(error)).toBe("provider");
  });

  it("rejects provider status and empty forecast payloads", async () => {
    await expect(parseKmaItems(new Response("{}", { status: 503 }))).rejects.toThrow("KMA_REQUEST_FAILED");
    await expect(parseKmaItems(new Response(JSON.stringify({ response: { header: { resultCode: "00" }, body: { items: { item: [] } } } })))).rejects.toThrow("KMA_FORECAST_NOT_FOUND");
  });

  it("returns a documented successful item array", async () => {
    const item = { category: "TMP", fcstDate: "20260831", fcstTime: "1200", fcstValue: "22" };
    await expect(parseKmaItems(new Response(JSON.stringify({
      response: { header: { resultCode: "00" }, body: { items: { item: [item] } } },
    })))).resolves.toEqual([item]);
  });
});
