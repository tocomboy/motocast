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

  it("records only a bounded HTTP status or provider result code and rejects empty forecasts", async () => {
    await expect(parseKmaItems(new Response("{}", { status: 503 }))).rejects.toEqual(new Error("KMA_HTTP_STATUS_503"));
    await expect(parseKmaItems(new Response(JSON.stringify({
      response: { header: { resultCode: "03", resultMsg: "provider detail is not logged" } },
    })))).rejects.toEqual(new Error("KMA_RESULT_CODE_03"));
    await expect(parseKmaItems(new Response(JSON.stringify({
      response: { header: { resultCode: "ABCDEFGHIJKLMNOP" } },
    })))).rejects.toEqual(new Error("KMA_RESULT_CODE_ABCDEFGHIJKLMNOP"));
    for (const resultCode of ["", "ABCDEFGHIJKLMNOPQ", "unsafe value", "unsafe\nvalue", "오류", 3, null]) {
      const error = await parseKmaItems(new Response(JSON.stringify({
        response: { header: { resultCode } },
      }))).catch((reason: unknown) => reason);
      expect(error).toEqual(new Error("KMA_RESULT_CODE_UNKNOWN"));
      expect(weatherFailureKind(error)).toBe("provider");
    }
    await expect(parseKmaItems(new Response(JSON.stringify({ response: { header: { resultCode: "00" }, body: { items: { item: [] } } } })))).rejects.toThrow("KMA_FORECAST_NOT_FOUND");
  });

  it.each([
    { label: "empty object", value: {} },
    { label: "null", value: null },
    { label: "invalid date", value: { baseDate: "20260230", baseTime: "1200", category: "TMP", fcstDate: "20260901", fcstTime: "1300", fcstValue: "22", nx: 60, ny: 127 } },
    { label: "invalid time", value: { baseDate: "20260901", baseTime: "2460", category: "TMP", fcstDate: "20260901", fcstTime: "1300", fcstValue: "22", nx: 60, ny: 127 } },
    { label: "non-string value", value: { baseDate: "20260901", baseTime: "1200", category: "TMP", fcstDate: "20260901", fcstTime: "1300", fcstValue: 22, nx: 60, ny: 127 } },
  ])("rejects malformed successful forecast item: $label", async ({ value }) => {
    await expect(parseKmaItems(new Response(JSON.stringify({
      response: { header: { resultCode: "00" }, body: { items: { item: [value] } } },
    })))).rejects.toEqual(new Error("KMA_INVALID_RESPONSE"));
  });

  it("returns a documented successful item array", async () => {
    const item = {
      baseDate: "20260831",
      baseTime: "1100",
      category: "TMP",
      fcstDate: "20260831",
      fcstTime: "1200",
      fcstValue: "22",
      nx: 60,
      ny: 127,
    };
    await expect(parseKmaItems(new Response(JSON.stringify({
      response: { header: { resultCode: "00" }, body: { items: { item: [item] } } },
    })))).resolves.toEqual([item]);
  });
});
