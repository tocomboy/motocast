import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { signPlace } from "../_shared/place-verification";

// Real request validation and error mapping; only membership and storage are observed.
const auth = vi.hoisted(() => ({ requireMember: vi.fn(), serviceClient: vi.fn() }));
const rpc = vi.hoisted(() => vi.fn());
vi.mock("../_shared/auth.ts", () => auth);

const secret = "fixture-signing-secret-for-unit-tests-only";
const MESSAGE = "식사 시간은 45분으로 바뀌었어요. 앱을 최신 버전으로 업데이트한 뒤 다시 시도해 주세요.";

async function place(id: string, longitude: number, extra: Record<string, unknown> = {}) {
  const verified = { kakaoPlaceId: id, name: `장소 ${id}`, address: "공개 시험 주소", roadAddress: null, longitude, latitude: 37.5 };
  return {
    ...verified, id, label: verified.name, verificationToken: await signPlace(verified, secret),
    kind: "pass-through", dwellMinutes: 0, selected: true, winding: false, ...extra,
  };
}

async function body(points: unknown[]) {
  return {
    saveOperationId: "123e4567-e89b-42d3-a456-426614174000",
    collectionId: null,
    title: "식사 코스",
    description: "",
    origin: await place("origin", 127.0),
    destination: await place("destination", 127.2),
    points,
  };
}

describe("save-collection fixed 45-minute meal dwell", () => {
  let handler: (request: Request) => Promise<Response>;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const call = async (points: unknown[]) => handler(new Request("https://fixture/functions/v1/save-collection", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(await body(points)),
  }));

  beforeAll(async () => {
    vi.stubGlobal("Deno", {
      env: { get: (name: string) => name === "PLACE_VERIFICATION_SECRET" ? secret : undefined },
      serve: (callback: typeof handler) => { handler = callback; },
    });
    await import("./index");
  });
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireMember.mockResolvedValue({ supabase: {}, user: { id: "fixture-member" } });
    auth.serviceClient.mockReturnValue({ rpc });
    rpc.mockResolvedValue({ data: [{ collection_id: "c-1", version_id: "v-1", version_number: 1 }], error: null });
  });
  afterAll(() => { log.mockRestore(); vi.unstubAllGlobals(); });

  it.each([["meal", 44], ["meal", 46], ["meal", 60], ["lunch", 60], ["dinner", 60]])(
    "refuses a %s dwell of %i minutes with a fixed code and update guidance before storage", async (role, dwell) => {
      const response = await call([await place(`${role}-1`, 127.1, { kind: "stop", dwellMinutes: dwell, stopRole: role })]);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: MESSAGE, code: "MEAL_DWELL_FIXED" });
      expect(auth.serviceClient).not.toHaveBeenCalled();
      expect(rpc).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledExactlyOnceWith("save-collection failed", "MEAL_DWELL_FIXED");
    },
  );

  it("saves 45-minute meals with editable rests", async () => {
    const response = await call([
      await place("meal-1", 127.05, { kind: "stop", dwellMinutes: 45, stopRole: "meal" }),
      await place("rest-1", 127.1, { kind: "optional", dwellMinutes: 60, stopRole: "rest" }),
      await place("dinner-1", 127.15, { kind: "stop", dwellMinutes: 45, stopRole: "dinner" }),
    ]);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ collectionId: "c-1", versionId: "v-1", versionNumber: 1 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("keeps other error responses without a code", async () => {
    const response = await call([await place("meal-1", 127.1, { kind: "stop", dwellMinutes: 0, stopRole: "meal" })]);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "입력값을 확인해 주세요." });
    expect(rpc).not.toHaveBeenCalled();
  });
});
