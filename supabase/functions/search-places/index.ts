import { consumeBudget, requireMember } from "../_shared/auth.ts";
import { executeBudgetedProviderCall } from "../_shared/budgeted-call.ts";
import { corsHeaders, jsonResponse, safeErrorMessage, safeErrorStatus } from "../_shared/http.ts";
import {
  normalizeKakaoPlaceDocuments,
  parsePlaceSearchRequest,
  type PlaceSearchResult,
} from "../_shared/place-search.ts";
import { signPlace } from "../_shared/place-verification.ts";
import { type MapPointRequest, normalizeMapPlace, normalizeRegionPlace, parseMapPointRequest } from "../_shared/map-place.ts";

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
    const { user } = await requireMember(request);
    const raw = await request.json();
    if (raw?.mode !== undefined && raw.mode !== "keyword" && raw.mode !== "coordinate") throw new Error("INVALID_PLACE_SEARCH_REQUEST");
    const coordinate = raw?.mode === "coordinate" ? parseMapPointRequest(raw) : null;
    const input = coordinate ? null : parsePlaceSearchRequest(raw);
    const apiKey = Deno.env.get("KAKAO_REST_API_KEY");
    if (!apiKey) throw new Error("PROVIDER_NOT_CONFIGURED");
    const verificationSecret = Deno.env.get("PLACE_VERIFICATION_SECRET");
    if (!verificationSecret) throw new Error("PLACE_VERIFICATION_NOT_CONFIGURED");

    const lookup = async (url: URL) => {
      const { result: provider } = await executeBudgetedProviderCall(
        // Historical operation name: both Local lookup modes spend the same
        // existing shared free quota. Coordinate lookup never bypasses the budget.
        () => consumeBudget(user.id, "kakao", "local_keyword_search", localLimit()),
        () => fetch(url, {
          headers: { Authorization: `KakaoAK ${apiKey}` },
          signal: AbortSignal.timeout(8_000),
        }),
      );
      if (!provider.ok) throw new Error("KAKAO_PLACE_SEARCH_FAILED");
      return await provider.json() as { documents?: unknown; meta?: { is_end?: boolean } };
    };
    const coordinateUrl = (path: string, point: MapPointRequest) => {
      const url = new URL(`https://dapi.kakao.com/v2/local/geo/${path}`);
      url.searchParams.set("x", String(point.longitude));
      url.searchParams.set("y", String(point.latitude));
      url.searchParams.set("input_coord", "WGS84");
      return url;
    };

    let providerPlaces: PlaceSearchResult[] = [];
    let isEnd = true;
    if (coordinate) {
      let mapPlace = normalizeMapPlace((await lookup(coordinateUrl("coord2address.json", coordinate))).documents, coordinate);
      // Opt-in only: one extra budgeted region lookup when no address exists. Any
      // failure is an error; nothing is retried or refunded.
      if (!mapPlace && coordinate.fallback === "region") {
        mapPlace = normalizeRegionPlace((await lookup(coordinateUrl("coord2regioncode.json", coordinate))).documents, coordinate);
      }
      providerPlaces = mapPlace ? [mapPlace] : [];
    } else if (input) {
      const url = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
      url.searchParams.set("query", input.query);
      url.searchParams.set("page", String(input.page));
      url.searchParams.set("size", String(input.size));
      url.searchParams.set("sort", "accuracy");
      const payload = await lookup(url);
      providerPlaces = normalizeKakaoPlaceDocuments(payload.documents);
      isEnd = payload.meta?.is_end === true;
    }
    const places = await Promise.all(providerPlaces.map(async (place) => ({
      ...place,
      verificationToken: await signPlace(place, verificationSecret),
    })));

    return jsonResponse({ places, isEnd }, 200, cors);
  } catch (error) {
    console.error("search-places failed", safeErrorMessage(error));
    return jsonResponse({ error: safeErrorMessage(error) }, safeErrorStatus(error), cors);
  }
});
