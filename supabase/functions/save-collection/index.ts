import { requireMember, serviceClient } from "../_shared/auth.ts";
import { parseCollectionSaveRequest } from "../_shared/collection-request.ts";
import { corsHeaders, jsonResponse, safeErrorMessage, safeErrorStatus } from "../_shared/http.ts";

Deno.serve(async (request) => {
  const cors = corsHeaders(request);
  if (!cors) return jsonResponse({ error: "ORIGIN_NOT_ALLOWED" }, 403, {});
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405, cors);

  try {
    const { user } = await requireMember(request);
    const verificationSecret = Deno.env.get("PLACE_VERIFICATION_SECRET");
    if (!verificationSecret) throw new Error("PLACE_VERIFICATION_NOT_CONFIGURED");
    const input = await parseCollectionSaveRequest(await request.json(), verificationSecret);
    const { data, error } = await serviceClient().rpc("save_collection_version_internal", {
      member_id: user.id,
      save_operation_id: input.saveOperationId,
      target_collection_id: input.collectionId,
      collection_title: input.title,
      collection_description: input.description,
      collection_points: {
        origin: input.origin,
        destination: input.destination,
        points: input.points,
      },
    });
    if (error || !Array.isArray(data) || data.length !== 1) throw new Error("COLLECTION_PERSIST_FAILED");
    const row = data[0] as { collection_id?: unknown; version_id?: unknown; version_number?: unknown };
    if (typeof row.collection_id !== "string" || typeof row.version_id !== "string" || !Number.isInteger(row.version_number)) {
      throw new Error("COLLECTION_PERSIST_FAILED");
    }
    return jsonResponse({
      collectionId: row.collection_id,
      versionId: row.version_id,
      versionNumber: row.version_number,
    }, 200, cors);
  } catch (error) {
    console.error("save-collection failed", error instanceof Error ? error.message : "unknown error");
    return jsonResponse({ error: safeErrorMessage(error) }, safeErrorStatus(error), cors);
  }
});
