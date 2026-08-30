const HANDOFF_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type KakaoOidcPayload = {
  idToken: string;
  accessToken: string;
  nonce: string;
  expiresAt: number;
};

export function isKakaoOidcHandoff(value: unknown): value is string {
  return typeof value === "string" && HANDOFF_PATTERN.test(value);
}

export function kakaoOidcStartUrl(supabaseUrl: string, applicationOrigin: string): string {
  const supabase = new URL(supabaseUrl);
  const application = new URL(applicationOrigin);
  if (
    supabase.pathname !== "/" || supabase.search || supabase.hash ||
    application.pathname !== "/" || application.search || application.hash ||
    (supabase.protocol !== "https:" && supabase.hostname !== "127.0.0.1" && supabase.hostname !== "localhost") ||
    (application.protocol !== "https:" && application.hostname !== "127.0.0.1" && application.hostname !== "localhost")
  ) {
    throw new Error("OIDC_CONFIGURATION_INVALID");
  }
  const start = new URL("/functions/v1/kakao-oidc/start", supabase.origin);
  start.searchParams.set("return_to", new URL("/auth/kakao/callback", application.origin).toString());
  return start.toString();
}

function parsePayload(value: unknown): KakaoOidcPayload {
  if (!value || typeof value !== "object") throw new Error("OIDC_HANDOFF_INVALID");
  const record = value as Record<string, unknown>;
  if (
    typeof record.idToken !== "string" || record.idToken.length < 100 || record.idToken.length > 10_000 ||
    typeof record.accessToken !== "string" || record.accessToken.length < 10 || record.accessToken.length > 10_000 ||
    typeof record.nonce !== "string" || !HANDOFF_PATTERN.test(record.nonce) ||
    typeof record.expiresAt !== "number" || !Number.isSafeInteger(record.expiresAt) || record.expiresAt <= Date.now()
  ) {
    throw new Error("OIDC_HANDOFF_INVALID");
  }
  return record as KakaoOidcPayload;
}

export async function consumeKakaoOidcHandoff(
  supabaseUrl: string,
  publishableKey: string,
  applicationOrigin: string,
  handoff: string,
  fetcher: typeof fetch = fetch,
): Promise<KakaoOidcPayload> {
  if (!isKakaoOidcHandoff(handoff)) throw new Error("OIDC_HANDOFF_INVALID");
  const endpoint = new URL("/functions/v1/kakao-oidc/consume", new URL(supabaseUrl).origin);
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: {
      apikey: publishableKey,
      "content-type": "application/json",
      origin: new URL(applicationOrigin).origin,
    },
    body: JSON.stringify({ handoff }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("OIDC_HANDOFF_INVALID");
  return parsePayload(await response.json());
}
