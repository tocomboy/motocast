import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  reserveBudget: vi.fn(),
  served: vi.fn(),
}));

vi.mock("../_shared/auth.ts", () => ({
  requireMember: mocks.authenticate,
  consumeBudget: mocks.reserveBudget,
}));

type Handler = (request: Request) => Promise<Response>;
type CreateHandler = (overrides?: Record<string, unknown>) => Handler;

describe("temporary KMA binding probe", () => {
  const projectUrl = "https://lehjmbgfpoemqcwxowbx.supabase.co";
  const endpoint = `${projectUrl}/functions/v1/kma-binding-probe`;
  const memberId = "fixture-member";
  const capability = "a".repeat(64);
  const privateValue = "fixture-private-key-and-provider-message";
  const capturedNow = Date.parse("2026-09-05T09:00:00.000Z");
  let createProbeHandler: CreateHandler;
  let memberHash: string;
  let capabilityHash: string;

  const hash = async (value: string) => {
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(value),
    );
    return [...new Uint8Array(bytes)].map((byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
  };

  beforeAll(async () => {
    vi.stubGlobal("Deno", {
      env: { get: vi.fn() },
      serve: mocks.served,
    });
    ({ createProbeHandler } = await import("./index.ts"));
    memberHash = await hash(memberId);
    capabilityHash = await hash(capability);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticate.mockResolvedValue({
      user: { id: memberId },
      supabase: {},
      membership: { role: "member" },
    });
    mocks.reserveBudget.mockResolvedValue(1);
  });

  function dependencies(providerFetch = vi.fn()) {
    return {
      authenticate: mocks.authenticate,
      reserveBudget: mocks.reserveBudget,
      providerFetch,
      env: (name: string) =>
        ({
          SUPABASE_URL: projectUrl,
          KMA_APIHUB_KEY: privateValue,
          KMA_DAILY_LIMIT: "17",
        })[name],
      now: () => capturedNow,
      config: {
        memberHash,
        capabilityHash,
        expiresAt: "2026-09-06T00:00:00.000Z",
        grid: { nx: 60, ny: 127 },
      },
    };
  }

  function request(url = endpoint, init: RequestInit = {}) {
    return new Request(url, {
      method: "POST",
      headers: {
        authorization: "Bearer fixture-auth",
        "x-motocast-probe-capability": capability,
        ...init.headers,
      },
      ...init,
    });
  }

  function providerResponse(
    url: URL,
    options: { mismatch?: boolean; resultCode?: string } = {},
  ) {
    const model = url.pathname.endsWith("getUltraSrtFcst") ? "ultra" : "short";
    const baseDate = url.searchParams.get("base_date")!;
    const requestedTime = url.searchParams.get("base_time")!;
    const baseTime = options.mismatch
      ? String((Number(requestedTime.slice(0, 2)) + 23) % 24).padStart(2, "0") +
        requestedTime.slice(2)
      : requestedTime;
    const categories = model === "ultra"
      ? [["T1H", "22"], ["POP", "30"], ["WSD", "2.5"], ["SKY", "3"], [
        "PTY",
        "0",
      ]]
      : [["TMP", "22"], ["POP", "30"], ["WSD", "2.5"], ["SKY", "3"], [
        "PTY",
        "0",
      ]];
    const item = categories.map(([category, fcstValue]) => ({
      baseDate,
      baseTime,
      category,
      fcstDate: "20260905",
      fcstTime: "2100",
      fcstValue,
      nx: 60,
      ny: 127,
    }));
    return new Response(JSON.stringify({
      response: {
        header: { resultCode: options.resultCode ?? "00" },
        body: { items: { item } },
      },
    }));
  }

  async function body(response: Response) {
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    return response.json();
  }

  it.each([
    ["method", () => request(endpoint, { method: "GET" })],
    ["query", () => request(`${endpoint}?unexpected=1`)],
    ["body", () => request(endpoint, { body: "" })],
    [
      "origin",
      () =>
        request(endpoint, { headers: { origin: "https://preview.example" } }),
    ],
  ])(
    "denies the %s request gate before auth, budget, or provider use",
    async (_label, buildRequest) => {
      const providerFetch = vi.fn();
      const response = await createProbeHandler(dependencies(providerFetch))(
        buildRequest(),
      );
      expect((await body(response)).run).toBe("STOPPED");
      expect(mocks.authenticate).not.toHaveBeenCalled();
      expect(mocks.reserveBudget).not.toHaveBeenCalled();
      expect(providerFetch).not.toHaveBeenCalled();
    },
  );

  it("denies project, expiry, member, and capability gates without consuming budget", async () => {
    const cases = [
      {
        overrides: {
          env: (name: string) =>
            name === "SUPABASE_URL" ? "https://foreign.example" : privateValue,
        },
        expected: "PROJECT_MISMATCH",
      },
      {
        overrides: { now: () => Date.parse("2026-09-06T00:00:00.000Z") },
        expected: "PROBE_EXPIRED",
      },
      {
        before: () =>
          mocks.authenticate.mockResolvedValue({
            user: { id: "foreign-member" },
          }),
        overrides: {},
        expected: "MEMBER_MISMATCH",
      },
      {
        request: () =>
          request(endpoint, {
            headers: { "x-motocast-probe-capability": "b".repeat(64) },
          }),
        overrides: {},
        expected: "CAPABILITY_INVALID",
      },
    ];
    for (const testCase of cases) {
      vi.clearAllMocks();
      mocks.authenticate.mockResolvedValue({ user: { id: memberId } });
      testCase.before?.();
      const providerFetch = vi.fn();
      const response = await createProbeHandler({
        ...dependencies(providerFetch),
        ...testCase.overrides,
      })(testCase.request?.() ?? request());
      expect((await body(response)).stopReason).toBe(testCase.expected);
      expect(mocks.reserveBudget).not.toHaveBeenCalled();
      expect(providerFetch).not.toHaveBeenCalled();
    }
  });

  it("stops an unknown budget reservation result before the provider", async () => {
    mocks.reserveBudget.mockRejectedValue(new Error(privateValue));
    const providerFetch = vi.fn();
    const response = await createProbeHandler(dependencies(providerFetch))(
      request(),
    );
    expect(await body(response)).toMatchObject({
      tag: "KMA_BINDING_PROBE_V1",
      run: "STOPPED",
      providerCalls: 0,
      budgetReservationFailures: 1,
      stopReason: "BUDGET_FAILED",
      results: [],
    });
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("makes exactly two budgeted baseline calls and passes the real parsers", async () => {
    const providerFetch = vi.fn(async (input: URL, init: RequestInit) => {
      expect(init).toMatchObject({ method: "GET", redirect: "error" });
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(input.toString()).toContain(encodeURIComponent(privateValue));
      return providerResponse(input);
    });
    const output = await body(
      await createProbeHandler(dependencies(providerFetch))(request()),
    );
    expect(output).toMatchObject({
      tag: "KMA_BINDING_PROBE_V1",
      run: "COMPLETE",
      providerCalls: 2,
      budgetReservationFailures: 0,
      results: [
        {
          model: "ultra",
          requested: { date: "20260905", time: "1730" },
          parser: { status: "PASS" },
        },
        {
          model: "short",
          requested: { date: "20260905", time: "1700" },
          parser: { status: "PASS" },
        },
      ],
    });
    expect(
      output.results.every((result: { binding: string }) =>
        result.binding.startsWith("B1 ")
      ),
    ).toBe(true);
    expect(providerFetch).toHaveBeenCalledTimes(2);
    expect(mocks.reserveBudget).toHaveBeenCalledTimes(2);
    expect(mocks.reserveBudget.mock.calls.map((call) => call.slice(1))).toEqual(
      [
        ["kma", "ultra_forecast", 17],
        ["kma", "short_forecast", 17],
      ],
    );
  });

  it("queries the mismatched model's immediately previous regular issue after both baselines", async () => {
    const providerFetch = vi.fn(async (input: URL) =>
      providerResponse(input, {
        mismatch: providerFetch.mock.calls.length === 1,
      })
    );
    const output = await body(
      await createProbeHandler(dependencies(providerFetch))(request()),
    );
    expect(output.run).toBe("COMPLETE");
    expect(output.providerCalls).toBe(3);
    expect(output.results).toHaveLength(3);
    expect(output.results[0]).toMatchObject({
      model: "ultra",
      requested: { date: "20260905", time: "1730" },
      returnedIssuances: [{
        date: "20260905",
        time: "1630",
        deltaMinutes: -60,
      }],
      parser: {
        status: "FAIL",
        code: "KMA_INVALID_RESPONSE",
        reason: "BASE_TIME_MISMATCH",
      },
    });
    expect(output.results[1]).toMatchObject({
      model: "short",
      requested: { time: "1700" },
      parser: { status: "PASS" },
    });
    expect(output.results[2]).toMatchObject({
      model: "ultra",
      requested: { date: "20260905", time: "1630" },
      parser: { status: "PASS" },
    });
  });

  it("caps the comparison at a third call even when every response mismatches", async () => {
    const providerFetch = vi.fn(async (input: URL) =>
      providerResponse(input, { mismatch: true })
    );
    const output = await body(
      await createProbeHandler(dependencies(providerFetch))(request()),
    );
    expect(output).toMatchObject({ run: "COMPLETE", providerCalls: 3 });
    expect(output.results).toHaveLength(3);
    expect(providerFetch).toHaveBeenCalledTimes(3);
    expect(mocks.reserveBudget).toHaveBeenCalledTimes(3);
  });

  it.each(["timeout", "redirect"])(
    "stops safely on a %s provider failure with one charged attempt",
    async (kind) => {
      const timeout = vi.spyOn(AbortSignal, "timeout");
      const providerFetch = vi.fn(async (_input: URL, init: RequestInit) => {
        expect(init.redirect).toBe("error");
        throw kind === "timeout"
          ? new DOMException("private timeout detail", "AbortError")
          : new TypeError("private redirect detail");
      });
      const output = await body(
        await createProbeHandler(dependencies(providerFetch))(request()),
      );
      expect(output).toMatchObject({
        run: "STOPPED",
        providerCalls: 1,
        stopReason: "NETWORK_FAILED",
      });
      expect(JSON.stringify(output)).not.toContain("private");
      expect(timeout).toHaveBeenCalledWith(8_000);
      timeout.mockRestore();
    },
  );

  it("stops when the streamed response exceeds two MiB", async () => {
    const chunk = new Uint8Array(1024 * 1024 + 1);
    const providerFetch = vi.fn(async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(chunk);
            controller.enqueue(chunk);
            controller.close();
          },
        }),
      )
    );
    const output = await body(
      await createProbeHandler(dependencies(providerFetch))(request()),
    );
    expect(output).toMatchObject({
      run: "STOPPED",
      providerCalls: 1,
      stopReason: "RESPONSE_TOO_LARGE",
    });
    expect(output.results).toHaveLength(1);
    expect(output.results[0].binding).toMatch(/^B1 /);
  });

  it("classifies a mid-body stream failure as a network stop without leaking its message", async () => {
    const providerFetch = vi.fn(async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.error(new Error(privateValue));
          },
        }),
      )
    );
    const output = await body(
      await createProbeHandler(dependencies(providerFetch))(request()),
    );
    expect(output).toMatchObject({
      run: "STOPPED",
      providerCalls: 1,
      stopReason: "NETWORK_FAILED",
    });
    expect(output.results).toHaveLength(1);
    expect(JSON.stringify(output)).not.toContain(privateValue);
  });

  it("classifies a null-body HTTP response through the real parser", async () => {
    const providerFetch = vi.fn(async () =>
      new Response(null, { status: 204 })
    );
    const output = await body(
      await createProbeHandler(dependencies(providerFetch))(request()),
    );
    expect(output).toMatchObject({
      run: "STOPPED",
      providerCalls: 1,
      stopReason: "INVALID_JSON",
      results: [{
        parser: {
          status: "FAIL",
          code: "KMA_INVALID_RESPONSE",
          reason: "JSON_BODY",
        },
      }],
    });
  });

  it("stops on invalid JSON after running the real parser classification", async () => {
    const providerFetch = vi.fn(async () =>
      new Response(`not-json-${privateValue}`)
    );
    const output = await body(
      await createProbeHandler(dependencies(providerFetch))(request()),
    );
    expect(output).toMatchObject({
      run: "STOPPED",
      providerCalls: 1,
      stopReason: "INVALID_JSON",
      results: [{
        parser: {
          status: "FAIL",
          code: "KMA_INVALID_RESPONSE",
          reason: "JSON_BODY",
        },
      }],
    });
    expect(JSON.stringify(output)).not.toContain(privateValue);
  });

  it("redacts foreign provider fields and malformed issuance identities", async () => {
    const providerFetch = vi.fn(async (input: URL) => {
      const response = providerResponse(input);
      const decoded = await response.json();
      decoded.response.header.resultMsg = privateValue;
      decoded.response.body.items.item[0].baseDate = "20260230";
      return new Response(JSON.stringify(decoded));
    });
    const output = await body(
      await createProbeHandler(dependencies(providerFetch))(request()),
    );
    expect(output).toMatchObject({
      run: "STOPPED",
      providerCalls: 1,
      stopReason: "PROVIDER_FAILED",
      results: [{
        parser: {
          status: "FAIL",
          code: "KMA_INVALID_RESPONSE",
          reason: "BASE_DATE_FORMAT",
        },
      }],
    });
    expect(output.results[0].returnedIssuances[0]).toEqual({
      identity: "INVALID",
    });
    expect(output.results[0].parser.status).not.toBe("PASS");
    expect(JSON.stringify(output)).not.toContain(privateValue);
    expect(JSON.stringify(output)).not.toContain(memberId);
  });

  it("does not call the provider if the deadline passes after a successful reservation", async () => {
    const times = [
      capturedNow,
      capturedNow,
      Date.parse("2026-09-06T00:00:00.000Z"),
    ];
    const providerFetch = vi.fn();
    const response = await createProbeHandler({
      ...dependencies(providerFetch),
      now: () => times.shift() ?? times.at(-1)!,
    })(request());
    expect(await body(response)).toMatchObject({
      run: "STOPPED",
      providerCalls: 0,
      budgetReservationFailures: 0,
      stopReason: "DEADLINE_EXCEEDED_AFTER_RESERVATION",
    });
    expect(mocks.reserveBudget).toHaveBeenCalledTimes(1);
    expect(providerFetch).not.toHaveBeenCalled();
  });
});
