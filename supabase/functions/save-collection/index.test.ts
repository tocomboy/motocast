import { beforeAll, describe, expect, it, vi } from "vitest";

const serve = vi.fn();

beforeAll(() => {
  vi.stubGlobal("Deno", {
    env: { get: (name: string) => name === "ALLOWED_ORIGINS" ? "https://preview.example" : undefined },
    serve,
  });
});

describe("rollback save-collection handler", () => {
  it("returns a fixed 503 without reading the body or entering a mutation boundary", async () => {
    const { handleRollbackCollectionSave } = await import("./index");
    const json = vi.fn(() => { throw new Error("BODY_MUST_NOT_BE_READ"); });
    const request = {
      method: "POST",
      headers: new Headers({ origin: "https://preview.example" }),
      json,
    } as unknown as Request;

    const response = await handleRollbackCollectionSave(request);

    expect(serve).toHaveBeenCalledWith(handleRollbackCollectionSave);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "롤백 안전 모드에서는 컬렉션 변경을 일시적으로 사용할 수 없습니다.",
    });
    expect(json).not.toHaveBeenCalled();
  });
});
