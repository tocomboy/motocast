import {
  authenticatedOidcReturnTo,
  clearOidcCookie,
  createHandoffToken,
  encryptKakaoTokenPayload,
  KAKAO_OIDC_HANDOFF_TTL_MS,
  oidcCookieFromHeader,
  sha256Hex,
  verifyOidcAttempt,
} from "./kakao-oidc.ts";

export type KakaoOidcVerificationEnvironment = {
  allowedOrigins: readonly string[];
  stateSecret: string;
};

export type KakaoOidcProviderCredentials = {
  clientId: string;
  clientSecret: string;
};

export type KakaoOidcHandoffInput = {
  handoffHash: string;
  bindingHash: string;
  encryptedPayload: string;
  expiresAt: string;
};

export type KakaoOidcCallbackRuntime = {
  verificationEnvironment(): KakaoOidcVerificationEnvironment;
  providerCredentials(): KakaoOidcProviderCredentials;
  exchangeCode(
    code: string,
    request: Request,
    credentials: KakaoOidcProviderCredentials,
  ): Promise<{ idToken: string; accessToken: string }>;
  persistHandoff(input: KakaoOidcHandoffInput): Promise<void>;
  now(): number;
};

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

function genericFailure(status: number, cookie: string) {
  const headers = new Headers({ ...noStoreHeaders, "content-type": "text/plain; charset=utf-8" });
  headers.set("set-cookie", cookie);
  return new Response("카카오 로그인 요청을 확인할 수 없습니다.", { status, headers });
}

function applicationFailureUrl(returnTo: string | URL): string {
  return new URL("/auth/kakao/callback?error=callback", new URL(returnTo).origin).toString();
}

async function verifiedCallback(
  request: Request,
  runtime: KakaoOidcCallbackRuntime,
  environment: KakaoOidcVerificationEnvironment,
): Promise<Response> {
  const url = new URL(request.url);
  const attempt = await verifyOidcAttempt(
    oidcCookieFromHeader(request.headers.get("cookie")),
    url.searchParams.get("state"),
    environment.allowedOrigins,
    environment.stateSecret,
  );
  const clearCookie = clearOidcCookie();
  const errorUrl = applicationFailureUrl(attempt.returnTo);
  if (url.searchParams.has("error")) return redirect(errorUrl, clearCookie);

  try {
    const code = url.searchParams.get("code");
    if (!code) throw new Error("OIDC_CODE_INVALID");
    const provider = await runtime.exchangeCode(code, request, runtime.providerCredentials());
    const now = runtime.now();
    const encryptedPayload = await encryptKakaoTokenPayload({
      ...provider,
      nonce: attempt.nonce,
      bindingHash: attempt.bindingHash,
      expiresAt: now + KAKAO_OIDC_HANDOFF_TTL_MS,
    }, environment.stateSecret);
    const handoff = createHandoffToken();
    await runtime.persistHandoff({
      handoffHash: await sha256Hex(handoff),
      bindingHash: attempt.bindingHash,
      encryptedPayload,
      expiresAt: new Date(now + KAKAO_OIDC_HANDOFF_TTL_MS).toISOString(),
    });
    return redirect(`${attempt.returnTo}#${handoff}`, clearCookie);
  } catch (error) {
    console.error("kakao-oidc callback failed", error instanceof Error ? error.message : "unknown error");
    return redirect(errorUrl, clearCookie);
  }
}

export async function handleKakaoOidcCallback(
  request: Request,
  runtime: KakaoOidcCallbackRuntime,
): Promise<Response> {
  try {
    const environment = runtime.verificationEnvironment();
    return await verifiedCallback(request, runtime, environment);
  } catch (error) {
    try {
      const environment = runtime.verificationEnvironment();
      const returnTo = await authenticatedOidcReturnTo(
        oidcCookieFromHeader(request.headers.get("cookie")),
        environment.allowedOrigins,
        environment.stateSecret,
      );
      return redirect(applicationFailureUrl(returnTo), clearOidcCookie());
    } catch {
      return genericFailure(
        error instanceof Error && error.message.includes("NOT_CONFIGURED") ? 503 : 400,
        clearOidcCookie(),
      );
    }
  }
}
