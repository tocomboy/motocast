import {
  handleKakaoOidcCallback,
  type KakaoOidcCallbackRuntime,
  type KakaoOidcProviderCredentials,
} from "./kakao-oidc-callback.ts";
import {
  createOidcAttempt,
  isOidcBindingHash,
  kakaoAuthorizeUrl,
  parseKakaoTokenResponse,
  setOidcCookie,
  validatedReturnTo,
} from "./kakao-oidc.ts";

const noStoreHeaders = {
  "cache-control": "private, no-store, max-age=0",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

export type KakaoOidcRequestRuntime = KakaoOidcCallbackRuntime & {
  consume(request: Request): Promise<Response>;
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

async function startKakaoOidc(
  request: Request,
  runtime: KakaoOidcRequestRuntime,
): Promise<Response> {
  const environment = runtime.verificationEnvironment();
  const credentials = runtime.providerCredentials();
  const url = new URL(request.url);
  const returnTo = validatedReturnTo(url.searchParams.get("return_to"), environment.allowedOrigins);
  const bindingHash = url.searchParams.get("binding_hash");
  if (!isOidcBindingHash(bindingHash)) throw new Error("OIDC_BINDING_INVALID");
  const { attempt, authorizeNonce, cookieValue } = await createOidcAttempt(
    returnTo,
    bindingHash,
    environment.stateSecret,
  );
  const authorize = kakaoAuthorizeUrl(
    credentials.clientId,
    credentials.callbackUri,
    attempt,
    authorizeNonce,
  );
  return redirect(authorize.toString(), setOidcCookie(cookieValue));
}

export async function exchangeKakaoOidcCode(
  code: string,
  credentials: KakaoOidcProviderCredentials,
  providerFetch: typeof fetch = fetch,
): Promise<{ idToken: string; accessToken: string }> {
  if (!/^[A-Za-z0-9_-]{1,512}$/u.test(code)) throw new Error("OIDC_CODE_INVALID");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    redirect_uri: credentials.callbackUri,
    code,
  });
  const response = await providerFetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" },
    body,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error("OIDC_PROVIDER_EXCHANGE_FAILED");
  return parseKakaoTokenResponse(await response.json());
}

export async function handleKakaoOidcRequest(
  request: Request,
  runtime: KakaoOidcRequestRuntime,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  try {
    if (pathname.endsWith("/start") && request.method === "GET") {
      return await startKakaoOidc(request, runtime);
    }
    if (pathname.endsWith("/callback") && request.method === "GET") {
      return await handleKakaoOidcCallback(request, runtime);
    }
    if (pathname.endsWith("/consume")) return await runtime.consume(request);
    return genericFailure(404);
  } catch (error) {
    console.error("kakao-oidc request failed", error instanceof Error ? error.message : "unknown error");
    return genericFailure(
      error instanceof Error && error.message.includes("NOT_CONFIGURED") ? 503 : 400,
    );
  }
}
