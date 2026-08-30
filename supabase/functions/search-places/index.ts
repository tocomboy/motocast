import { consumeBudget, requireMember } from "../_shared/auth.ts";
import { executeBudgetedProviderCall } from "../_shared/budgeted-call.ts";
import { corsHeaders, jsonResponse, safeErrorMessage, safeErrorStatus } from "../_shared/http.ts";
import {
  normalizeKakaoPlaceDocuments,
  parsePlaceSearchRequest,
} from "../_shared/place-search.ts";
import { signPlace } from "../_shared/place-verification.ts";

function localLimit() {
  const value = Number(Deno.env.get("KAKAO_LOCAL_DAILY_LIMIT"));
  if (!Number.isInteger(value) || value <= 0) throw new Error("API_BUDGET_NOT_CONFIGURED");
  return value;
}

Deno.serve(async (request) => {
  const cors = corsHeaders(request);
  if (!cors) return jsonResponse({ error: "ORIGIN_NOT_ALLOWED" }, 403, {});
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405, cors);

  try {
    const { supabase } = await requireMember(request);
    const input = parsePlaceSearchRequest(await request.json());
    const apiKey = Deno.env.get("KAKAO_REST_API_KEY");
    if (!apiKey) throw new Error("PROVIDER_NOT_CONFIGURED");
    const verificationSecret = Deno.env.get("PLACE_VERIFICATION_SECRET");
    if (!verificationSecret) throw new Error("PLACE_VERIFICATION_NOT_CONFIGURED");

    const url = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
    url.searchParams.set("query", input.query);
    url.searchParams.set("page", String(input.page));
    url.searchParams.set("size", String(input.size));
    url.searchParams.set("sort", "accuracy");

    const { result: provider } = await executeBudgetedProviderCall(
      () => consumeBudget(supabase, "kakao", "local_keyword_search", localLimit()),
      () => fetch(url, {
        headers: { Authorization: `KakaoAK ${apiKey}` },
        signal: AbortSignal.timeout(8_000),
      }),
    );
    if (!provider.ok) throw new Error("KAKAO_PLACE_SEARCH_FAILED");
    const payload = await provider.json() as { documents?: unknown; meta?: { is_end?: boolean } };
    const providerPlaces = normalizeKakaoPlaceDocuments(payload.documents);
    const places = await Promise.all(providerPlaces.map(async (place) => ({
      ...place,
      verificationToken: await signPlace(place, verificationSecret),
    })));

    return jsonResponse({ places, isEnd: payload.meta?.is_end === true }, 200, cors);
  } catch (error) {
    console.error("search-places failed", error instanceof Error ? error.message : "unknown error");
    return jsonResponse({ error: safeErrorMessage(error) }, safeErrorStatus(error), cors);
  }
});
