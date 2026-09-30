import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyPlace } from "../_shared/place-verification";
const auth = vi.hoisted(() => ({ requireMember: vi.fn(), consumeBudget: vi.fn() }));
vi.mock("../_shared/auth.ts", () => auth);

describe("search-places coordinate endpoint", () => {
  let handler: (request: Request) => Promise<Response>;
  const fetcher = vi.fn();
  const env = new Map([['KAKAO_REST_API_KEY','fixture-provider-key'], ['PLACE_VERIFICATION_SECRET','fixture-signing-secret-for-unit-tests-only'], ['KAKAO_LOCAL_DAILY_LIMIT','200']]);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const point = { mode: "coordinate", latitude: 37.338811234, longitude: 127.269952145 };
  const provider = () => new Response(JSON.stringify({ documents: [{ address: { address_name: "공개 시험 산 84-1" }, road_address: null }] }));
  const call = (body: unknown, origin = "http://localhost:3000") => handler(new Request("https://fixture/functions/v1/search-places", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }));
  beforeAll(async () => {
    vi.stubGlobal("Deno", { env: { get: (key: string) => env.get(key) }, serve: (fn: typeof handler) => { handler = fn; } });
    vi.stubGlobal("fetch", fetcher); await import("./index");
  });
  beforeEach(() => {
    vi.clearAllMocks(); auth.requireMember.mockResolvedValue({ user: {id: "fixture-member"} });
    auth.consumeBudget.mockResolvedValue(1); fetcher.mockImplementation(provider);
  });
  afterAll(() => { log.mockRestore(); vi.unstubAllGlobals(); });
  it("spends the existing Local quota before reverse lookup and returns a signed unchanged point", async () => {
    const response = await call(point); expect(response.status).toBe(200);
    expect(auth.consumeBudget).toHaveBeenCalledExactlyOnceWith("fixture-member", "kakao", "local_keyword_search", 200);
    expect(auth.consumeBudget.mock.invocationCallOrder[0]).toBeLessThan(fetcher.mock.invocationCallOrder[0]);
    const url = fetcher.mock.calls[0][0] as URL;
    expect(url.origin + url.pathname).toBe("https://dapi.kakao.com/v2/local/geo/coord2address.json");
    expect(Object.fromEntries(url.searchParams)).toEqual({x:"127.2699521",y:"37.3388112",input_coord:"WGS84"});
    const body = await response.json(); expect(body.isEnd).toBe(true); expect(body.places).toHaveLength(1);
    expect(body.places[0]).toMatchObject({kakaoPlaceId:"map:37.3388112:127.2699521",latitude:37.3388112,longitude:127.2699521,roadAddress:null});
    expect(await verifyPlace(body.places[0], body.places[0].verificationToken, env.get("PLACE_VERIFICATION_SECRET")!)).toBe(true);
  });
  it.each(["AUTH_REQUIRED", "MEMBERSHIP_REQUIRED", "API_DAILY_BUDGET_EXHAUSTED"])("rejects %s before provider work", async (code) => {
    if (code === "API_DAILY_BUDGET_EXHAUSTED") auth.consumeBudget.mockRejectedValue(new Error(code));
    else auth.requireMember.mockRejectedValue(new Error(code));
    const response = await call(point); expect(response.status).toBe(code === "AUTH_REQUIRED" ? 401 : code === "MEMBERSHIP_REQUIRED" ? 403 : 429);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([{...point,query:"forbidden"},{...point,latitude:91},{...point,mode:"other"}])("rejects malformed coordinate mode before quota", async (body) => {
    expect((await call(body)).status).toBe(400); expect(auth.consumeBudget).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("denies a foreign origin before membership and returns no signed place on malformed provider data", async () => {
    expect((await call(point,"https://foreign.invalid")).status).toBe(403); expect(auth.requireMember).not.toHaveBeenCalled();
    fetcher.mockResolvedValue(new Response(JSON.stringify({documents:[{}]})));
    const response = await call(point); expect(response.status).toBe(502); expect(await response.json()).not.toHaveProperty("places");
  });
  it("returns an empty address result and does not retry provider errors", async () => {
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({documents:[]})));
    expect(await (await call(point)).json()).toEqual({places:[],isEnd:true});
    fetcher.mockRejectedValueOnce(new Error("fixture-private-provider-body"));
    expect((await call(point)).status).toBe(502); expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(log.mock.calls)).not.toContain("fixture-private-provider-body");
  });
});
