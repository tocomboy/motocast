import { serviceClient } from "../_shared/auth.ts";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";
import {
  handleKakaoOidcCallback,
  type KakaoOidcCallbackRuntime,
  type KakaoOidcProviderCredentials,
  type KakaoOidcVerificationEnvironment,
} from "../_shared/kakao-oidc-callback.ts";
import {
  allowedOriginsFromEnvironment,
  createOidcAttempt,
  decryptKakaoTokenPayload,
  isHandoffToken,
  isOidcBindingHash,
  kakaoAuthorizeUrl,
  kakaoOidcProviderConfiguration,
  parseKakaoTokenResponse,
  setOidcCookie,
  sha256Hex,
  validatedReturnTo,
} from "../_shared/kakao-oidc.ts";

const noStoreHeaders = {
  "cache-control": "private, no-store, max-age=0",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

function redirect(location: string, cookie?: string) {
  const headers = new Headers({ ...noStoreHeaders, location });
  if (cookie) headers.set("set-cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function genericFailure(status = 400, cookie?: string) {
  const headers = new Headers({ ...noStoreHeaders, "content-type": "text/plain; charset=utf-8" });
  if (cookie) headers.set("set-cookie", cookie);
  return new Response("카카오 로그인 요청을 확인할 수 없습니다.", { status, headers });
}

function verificationEnvironment(): KakaoOidcVerificationEnvironment {
  const stateSecret = Deno.env.get("KAKAO_OIDC_STATE_SECRET");
  if (!stateSecret) throw new Error("OIDC_STATE_NOT_CONFIGURED");
  return {
    stateSecret,
    allowedOrigins: allowedOriginsFromEnvironment(Deno.env.get("ALLOWED_ORIGINS")),
  };
}

function providerCredentials(): KakaoOidcProviderCredentials {
  return kakaoOidcProviderConfiguration({
    clientId: Deno.env.get("KAKAO_REST_API_KEY"),
    clientSecret: Deno.env.get("KAKAO_LOGIN_CLIENT_SECRET"),
    supabaseUrl: Deno.env.get("SUPABASE_URL"),
  });
}

async function start(request: Request): Promise<Response> {
  const environment = verificationEnvironment();
  const credentials = providerCredentials();
  const url = new URL(request.url);
  const returnTo = validatedReturnTo(url.searchParams.get("return_to"), environment.allowedOrigins);
  const bindingHash = url.searchParams.get("binding_hash");
  if (!isOidcBindingHash(bindingHash)) throw new Error("OIDC_BINDING_INVALID");
  const { attempt, authorizeNonce, cookieValue } = await createOidcAttempt(
    returnTo,
    bindingHash,
    environment.stateSecret,
  );
  const authorize = kakaoAuthorizeUrl(credentials.clientId, credentials.callbackUri, attempt, authorizeNonce);
  return redirect(authorize.toString(), setOidcCookie(cookieValue));
}

async function exchangeKakaoCode(
  code: string,
  credentials: KakaoOidcProviderCredentials,
): Promise<{ idToken: string; accessToken: string }> {
  if (!/^[A-Za-z0-9_-]{1,512}$/u.test(code)) throw new Error("OIDC_CODE_INVALID");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    redirect_uri: credentials.callbackUri,
    code,
  });
  const response = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" },
    body,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("OIDC_PROVIDER_EXCHANGE_FAILED");
  return parseKakaoTokenResponse(await response.json());
}

const callbackRuntime: KakaoOidcCallbackRuntime = {
  verificationEnvironment,
  providerCredentials,
  exchangeCode: exchangeKakaoCode,
  persistHandoff: async (input) => {
    const { error } = await serviceClient().rpc("create_kakao_oidc_handoff_internal", {
      handoff_hash: input.handoffHash,
      handoff_binding_hash: input.bindingHash,
      handoff_payload: input.encryptedPayload,
      handoff_expires_at: input.expiresAt,
    });
    if (error) throw new Error("OIDC_HANDOFF_PERSISTENCE_FAILED");
  },
  now: Date.now,
};

async function consume(request: Request): Promise<Response> {
  const environment = verificationEnvironment();
  const origin = request.headers.get("origin");
  const cors = corsHeaders(request);
  if (!origin || !environment.allowedOrigins.includes(origin) || !cors) {
    return jsonResponse({ error: "ORIGIN_NOT_ALLOWED" }, 403, {});
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405, cors);
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return jsonResponse({ error: "INVALID_REQUEST" }, 400, cors);
  }

  try {
    const body = await request.json() as { handoff?: unknown; bindingHash?: unknown };
    if (!isHandoffToken(body.handoff) || !isOidcBindingHash(body.bindingHash)) {
      throw new Error("OIDC_HANDOFF_INVALID");
    }
    const { data, error } = await serviceClient().rpc("consume_kakao_oidc_handoff_internal", {
      handoff_hash: await sha256Hex(body.handoff),
      handoff_binding_hash: body.bindingHash,
    });
    if (error || typeof data !== "string") throw new Error("OIDC_HANDOFF_INVALID");
    const payload = await decryptKakaoTokenPayload(data, environment.stateSecret);
    if (payload.bindingHash !== body.bindingHash) throw new Error("OIDC_BINDING_INVALID");
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { ...cors, ...noStoreHeaders, "content-type": "application/json; charset=utf-8" },
    });
  } catch (error) {
    console.error("kakao-oidc consume failed", error instanceof Error ? error.message : "unknown error");
    return new Response(JSON.stringify({ error: "로그인 요청이 만료되었거나 이미 사용되었습니다." }), {
      status: 400,
      headers: { ...cors, ...noStoreHeaders, "content-type": "application/json; charset=utf-8" },
    });
  }
}

Deno.serve(async (request) => {
  const pathname = new URL(request.url).pathname;
  try {
    if (pathname.endsWith("/start") && request.method === "GET") return await start(request);
    if (pathname.endsWith("/callback") && request.method === "GET") {
      return await handleKakaoOidcCallback(request, callbackRuntime);
    }
    if (pathname.endsWith("/consume")) return await consume(request);
    return genericFailure(404);
  } catch (error) {
    console.error("kakao-oidc request failed", error instanceof Error ? error.message : "unknown error");
    return genericFailure(
      error instanceof Error && error.message.includes("NOT_CONFIGURED") ? 503 : 400,
      undefined,
    );
  }
});
