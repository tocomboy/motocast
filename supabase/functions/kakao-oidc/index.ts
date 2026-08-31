import { serviceClient } from "../_shared/auth.ts";
import { corsHeaders, jsonResponse } from "../_shared/http.ts";
import type {
  KakaoOidcProviderCredentials,
  KakaoOidcVerificationEnvironment,
} from "../_shared/kakao-oidc-callback.ts";
import {
  exchangeKakaoOidcCode,
  handleKakaoOidcRequest,
  type KakaoOidcRequestRuntime,
} from "../_shared/kakao-oidc-handler.ts";
import {
  allowedOriginsFromEnvironment,
  decryptKakaoTokenPayload,
  isHandoffToken,
  isOidcBindingHash,
  kakaoOidcProviderConfiguration,
  sha256Hex,
} from "../_shared/kakao-oidc.ts";

const noStoreHeaders = {
  "cache-control": "private, no-store, max-age=0",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

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

const requestRuntime: KakaoOidcRequestRuntime = {
  verificationEnvironment,
  providerCredentials,
  exchangeCode: exchangeKakaoOidcCode,
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
  consume: async (request) => {
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
  },
};

Deno.serve((request) => handleKakaoOidcRequest(request, requestRuntime));
