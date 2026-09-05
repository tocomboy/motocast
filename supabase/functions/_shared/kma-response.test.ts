import { describe, expect, it } from "vitest";

import { parseKmaItems } from "./kma-response";
import { KmaResponseValidationError, kmaResponseDiagnostic, weatherFailureKind } from "./weather-failure";

describe("parseKmaItems", () => {
  const expected = { baseDate: "20260831", baseTime: "1100", nx: 60, ny: 127, model: "short" as const };
  const parse = (response: Response) => parseKmaItems(response, expected);
  const validItem = {
    baseDate: expected.baseDate,
    baseTime: expected.baseTime,
    nx: expected.nx,
    ny: expected.ny,
    category: "TMP",
    fcstDate: "20260831",
    fcstTime: "1200",
    fcstValue: "22",
  };

  it.each([
    { reason: "ITEM_SHAPE", item: null },
    { reason: "BASE_BINDING", item: { ...validItem, baseTime: "0800" } },
    { reason: "CATEGORY_SHAPE", item: { ...validItem, category: "fixture-private-detail" } },
    { reason: "FORECAST_IDENTITY", item: { ...validItem, fcstDate: "invalid" } },
    { reason: "VALUE_CONTRACT", item: { ...validItem, fcstValue: "fixture-private-detail" } },
    { reason: "GRID_BINDING", item: { ...validItem, nx: 1 } },
  ] as const)("identifies $reason without returning rejected item data", async ({ reason, item }) => {
    const error = await parse(new Response(JSON.stringify({
      response: { header: { resultCode: "00" }, body: { items: { item: [item] } } },
    }))).catch((value: unknown) => value);
    expect(error).toEqual(new KmaResponseValidationError(reason));
    expect(kmaResponseDiagnostic(error)).toBe(reason);
  });

  it.each([
    { body: "not-json", reason: "JSON_BODY" },
    { body: "null", reason: "OBJECT_SHAPE" },
    { body: JSON.stringify({ response: { header: { resultCode: "00" }, body: { items: { item: [validItem, validItem] } } } }), reason: "DUPLICATE_IDENTITY" },
  ] as const)("identifies envelope/duplicate $reason with the same rejection", async ({ body, reason }) => {
    const error = await parse(new Response(body)).catch((value: unknown) => value);
    expect(error).toEqual(new KmaResponseValidationError(reason));
    expect(kmaResponseDiagnostic(error)).toBe(reason);
  });

  it("classifies malformed provider JSON as a KMA response failure", async () => {
    await expect(parse(new Response("not-json"))).rejects.toThrow("KMA_INVALID_RESPONSE");
  });

  it.each(["null", "[]", '"unexpected"'])("classifies structurally invalid provider JSON %s", async (body) => {
    const error = await parse(new Response(body)).catch((reason: unknown) => reason);
    expect(error).toEqual(new KmaResponseValidationError("OBJECT_SHAPE"));
    expect(weatherFailureKind(error)).toBe("provider");
  });

  it("records only a bounded HTTP status or provider result code and rejects empty forecasts", async () => {
    await expect(parse(new Response("{}", { status: 503 }))).rejects.toEqual(new Error("KMA_HTTP_STATUS_503"));
    await expect(parse(new Response(JSON.stringify({
      response: { header: { resultCode: "03", resultMsg: "provider detail is not logged" } },
    })))).rejects.toEqual(new Error("KMA_RESULT_CODE_03"));
    await expect(parse(new Response(JSON.stringify({
      response: { header: { resultCode: "ABCDEFGHIJKLMNOP" } },
    })))).rejects.toEqual(new Error("KMA_RESULT_CODE_ABCDEFGHIJKLMNOP"));
    for (const resultCode of ["", "ABCDEFGHIJKLMNOPQ", "unsafe value", "unsafe\nvalue", "오류", 3, null]) {
      const error = await parse(new Response(JSON.stringify({
        response: { header: { resultCode } },
      }))).catch((reason: unknown) => reason);
      expect(error).toEqual(new Error("KMA_RESULT_CODE_UNKNOWN"));
      expect(weatherFailureKind(error)).toBe("provider");
    }
    await expect(parse(new Response(JSON.stringify({ response: { header: { resultCode: "00" }, body: { items: { item: [] } } } })))).rejects.toThrow("KMA_FORECAST_NOT_FOUND");
  });

  it.each([
    { label: "empty object", value: {} },
    { label: "null", value: null },
    { label: "invalid date", value: { baseDate: "20260230", baseTime: "1200", category: "TMP", fcstDate: "20260901", fcstTime: "1300", fcstValue: "22", nx: 60, ny: 127 } },
    { label: "invalid time", value: { baseDate: "20260901", baseTime: "2460", category: "TMP", fcstDate: "20260901", fcstTime: "1300", fcstValue: "22", nx: 60, ny: 127 } },
    { label: "non-string value", value: { baseDate: "20260901", baseTime: "1200", category: "TMP", fcstDate: "20260901", fcstTime: "1300", fcstValue: 22, nx: 60, ny: 127 } },
  ])("rejects malformed successful forecast item: $label", async ({ value }) => {
    await expect(parse(new Response(JSON.stringify({
      response: { header: { resultCode: "00" }, body: { items: { item: [value] } } },
    })))).rejects.toEqual(new KmaResponseValidationError(value === null ? "ITEM_SHAPE" : "BASE_BINDING"));
  });

  it.each([
    { label: "wrong base", value: { ...validItem, baseTime: "0800" } },
    { label: "wrong grid", value: { ...validItem, nx: 1, ny: 1 } },
    { label: "blank temperature", value: { ...validItem, fcstValue: " " } },
    { label: "non-numeric temperature", value: { ...validItem, fcstValue: "not-a-number" } },
    { label: "hexadecimal probability", value: { ...validItem, category: "POP", fcstValue: "0x10" } },
    { label: "decimal-form integer probability", value: { ...validItem, category: "POP", fcstValue: "10.0" } },
    { label: "exponent wind", value: { ...validItem, category: "WSD", fcstValue: "1e2" } },
    { label: "explicit plus wind", value: { ...validItem, category: "WSD", fcstValue: "+2.5" } },
    { label: "probability over 100", value: { ...validItem, category: "POP", fcstValue: "101" } },
    { label: "negative wind", value: { ...validItem, category: "WSD", fcstValue: "-5" } },
    { label: "ultra-only precipitation code in short model", value: { ...validItem, category: "PTY", fcstValue: "5" } },
    { label: "ultra temperature in short model", value: { ...validItem, category: "T1H", fcstValue: "22" } },
  ])("rejects forecast identity or semantic mismatch: $label", async ({ label, value }) => {
    await expect(parse(new Response(JSON.stringify({
      response: { header: { resultCode: "00" }, body: { items: { item: [value] } } },
    })))).rejects.toEqual(new KmaResponseValidationError(label === "wrong base" ? "BASE_BINDING" : label === "wrong grid" ? "GRID_BINDING" : "VALUE_CONTRACT"));
  });

  it("rejects duplicate category identity within a forecast time", async () => {
    await expect(parse(new Response(JSON.stringify({
      response: { header: { resultCode: "00" }, body: { items: { item: [validItem, validItem] } } },
    })))).rejects.toEqual(new KmaResponseValidationError("DUPLICATE_IDENTITY"));
  });

  it("uses model-specific precipitation codes and accepts ordinary decimal values", async () => {
    const responseFor = (item: typeof validItem) => new Response(JSON.stringify({
      response: { header: { resultCode: "00" }, body: { items: { item: [item] } } },
    }));
    await expect(parse(responseFor({ ...validItem, category: "PTY", fcstValue: "4" }))).resolves.toHaveLength(1);
    await expect(parse(responseFor({ ...validItem, category: "WSD", fcstValue: "2.5" }))).resolves.toHaveLength(1);

    const parseUltra = (item: typeof validItem) => parseKmaItems(responseFor(item), { ...expected, model: "ultra" });
    await expect(parseUltra({ ...validItem, category: "PTY", fcstValue: "5" })).resolves.toHaveLength(1);
    await expect(parseUltra({ ...validItem, category: "PTY", fcstValue: "4" })).rejects.toEqual(new KmaResponseValidationError("VALUE_CONTRACT"));
    await expect(parseUltra({ ...validItem, category: "TMP", fcstValue: "22" })).rejects.toEqual(new KmaResponseValidationError("VALUE_CONTRACT"));
    await expect(parseUltra({ ...validItem, category: "T1H", fcstValue: "22" })).resolves.toHaveLength(1);
  });

  it("returns a documented successful item array", async () => {
    await expect(parse(new Response(JSON.stringify({
      response: { header: { resultCode: "00" }, body: { items: { item: [validItem] } } },
    })))).resolves.toEqual([validItem]);
  });
});
