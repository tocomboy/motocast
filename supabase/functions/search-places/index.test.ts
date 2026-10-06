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

describe("search-places region fallback", () => {
  let handler: (request: Request) => Promise<Response>;
  const fetcher = vi.fn();
  const env = new Map([['KAKAO_REST_API_KEY','fixture-provider-key'], ['PLACE_VERIFICATION_SECRET','fixture-signing-secret-for-unit-tests-only'], ['KAKAO_LOCAL_DAILY_LIMIT','200']]);
  let log: ReturnType<typeof vi.spyOn>;
  const point = { mode: "coordinate", latitude: 37.338811234, longitude: 127.269952145 };
  const opted = { ...point, fallback: "region" };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const noAddress = () => json({ documents: [] });
  const regions = (documents: unknown) => json({ documents, meta: { total_count: 2 } });
  const legal = { region_type: "B", address_name: "강원특별자치도 인제군 기린면 방동리", region_2depth_name: "인제군", region_3depth_name: "기린면 방동리", x: 128.2, y: 37.9 };
  const admin = { ...legal, region_type: "H", region_3depth_name: "기린면" };
  const call = (body: unknown) => handler(new Request("https://fixture/functions/v1/search-places", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify(body) }));
  const paths = () => fetcher.mock.calls.map(([url]) => (url as URL).pathname);
  beforeAll(async () => {
    vi.resetModules();
    log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("Deno", { env: { get: (key: string) => env.get(key) }, serve: (fn: typeof handler) => { handler = fn; } });
    vi.stubGlobal("fetch", fetcher); await import("./index");
  });
  beforeEach(() => {
    vi.clearAllMocks(); auth.requireMember.mockResolvedValue({ user: {id: "fixture-member"} });
    auth.consumeBudget.mockReset(); auth.consumeBudget.mockResolvedValue(1);
    fetcher.mockReset();
  });
  afterAll(() => { log.mockRestore(); vi.unstubAllGlobals(); });

  it("keeps the legacy single empty lookup when the request has no opt-in", async () => {
    fetcher.mockImplementationOnce(noAddress);
    expect(await (await call(point)).json()).toEqual({ places: [], isEnd: true });
    expect(auth.consumeBudget).toHaveBeenCalledTimes(1); expect(paths()).toEqual(["/v2/local/geo/coord2address.json"]);
  });

  it("spends one lookup when an address exists even with the opt-in", async () => {
    fetcher.mockResolvedValueOnce(json({ documents: [{ address: { address_name: "공개 시험 산 84-1" }, road_address: null }] }));
    const body = await (await call(opted)).json();
    expect(body.places[0].kakaoPlaceId).toBe("map:37.3388112:127.2699521");
    expect(auth.consumeBudget).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("charges the shared quota again before the single region lookup and signs the selected point", async () => {
    fetcher.mockImplementationOnce(noAddress).mockImplementationOnce(() => regions([admin, legal]));
    const response = await call(opted); expect(response.status).toBe(200);
    expect(auth.consumeBudget).toHaveBeenCalledTimes(2);
    for (const args of auth.consumeBudget.mock.calls) expect(args).toEqual(["fixture-member", "kakao", "local_keyword_search", 200]);
    const [budget1, budget2] = auth.consumeBudget.mock.invocationCallOrder;
    const [fetch1, fetch2] = fetcher.mock.invocationCallOrder;
    expect(budget1 < fetch1 && fetch1 < budget2 && budget2 < fetch2).toBe(true);
    expect(paths()).toEqual(["/v2/local/geo/coord2address.json", "/v2/local/geo/coord2regioncode.json"]);
    expect(Object.fromEntries((fetcher.mock.calls[1][0] as URL).searchParams)).toEqual({ x: "127.2699521", y: "37.3388112", input_coord: "WGS84" });
    const body = await response.json();
    expect(body.isEnd).toBe(true); expect(body.places).toHaveLength(1);
    expect(body.places[0]).toMatchObject({
      kakaoPlaceId: "map:37.3388112:127.2699521:region", name: "인제군 기린면 방동리 부근", address: legal.address_name,
      roadAddress: null, category: "지도에서 선택 · 상세 주소 없음", latitude: 37.3388112, longitude: 127.2699521,
    });
    expect(await verifyPlace(body.places[0], body.places[0].verificationToken, env.get("PLACE_VERIFICATION_SECRET")!)).toBe(true);
    expect(await verifyPlace({ ...body.places[0], kakaoPlaceId: "map:37.3388112:127.2699521" }, body.places[0].verificationToken, env.get("PLACE_VERIFICATION_SECRET")!)).toBe(false);
  });

  it.each([[[admin]], [[]]])("returns an empty result when no legal region exists", async (documents) => {
    fetcher.mockImplementationOnce(noAddress).mockImplementationOnce(() => regions(documents));
    expect(await (await call(opted)).json()).toEqual({ places: [], isEnd: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fails without a region call or refund when the second charge is refused at the last unit", async () => {
    auth.consumeBudget.mockResolvedValueOnce(200).mockRejectedValueOnce(new Error("API_DAILY_BUDGET_EXHAUSTED"));
    fetcher.mockImplementationOnce(noAddress);
    const response = await call(opted);
    expect(response.status).toBe(429); expect(await response.json()).not.toHaveProperty("places");
    expect(fetcher).toHaveBeenCalledTimes(1); expect(auth.consumeBudget).toHaveBeenCalledTimes(2);
  });

  it("fails when the second charge response is lost", async () => {
    auth.consumeBudget.mockResolvedValueOnce(1).mockRejectedValueOnce(new TypeError("fetch failed"));
    fetcher.mockImplementationOnce(noAddress);
    const response = await call(opted);
    expect(response.status).toBe(502); expect(await response.json()).not.toHaveProperty("places");
    expect(fetcher).toHaveBeenCalledTimes(1); expect(auth.consumeBudget).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["timeout", () => Promise.reject(new DOMException("timed out", "TimeoutError"))],
    ["4xx", () => Promise.resolve(json({ message: "fixture-private" }, 400))],
    ["5xx", () => Promise.resolve(json({ message: "fixture-private" }, 503))],
    ["invalid JSON", () => Promise.resolve(new Response("{not json"))],
    ["two legal regions", () => Promise.resolve(regions([legal, legal]))],
    ["malformed region", () => Promise.resolve(regions([{ ...legal, address_name: "기린면\n방동리" }]))],
    ["unknown region type", () => Promise.resolve(regions([legal, { ...admin, region_type: "Z" }]))],
  ])("reports a region lookup %s as an error without retry or empty disguise", async (_, second) => {
    fetcher.mockImplementationOnce(noAddress).mockImplementationOnce(second);
    const response = await call(opted);
    expect(response.status).toBe(502); expect(await response.json()).not.toHaveProperty("places");
    expect(fetcher).toHaveBeenCalledTimes(2); expect(auth.consumeBudget).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalled(); expect(JSON.stringify(log.mock.calls)).not.toContain("fixture-private");
  });

  it.each([{ ...point, fallback: "address" }, { ...point, fallback: null }, { ...opted, query: "x" }])("rejects a malformed opt-in before quota", async (body) => {
    expect((await call(body)).status).toBe(400);
    expect(auth.consumeBudget).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
});
