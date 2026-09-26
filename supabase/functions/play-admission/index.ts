import { authenticatedClient, serviceClient } from "../_shared/auth.ts";
import { handlePlayAdmission } from "../_shared/play-admission-handler.ts";
import { googlePlayDecoder, PlayAdmissionError, playPolicy } from "../_shared/play-integrity.ts";

let decoder: ReturnType<typeof googlePlayDecoder> | undefined;
const failures: Record<string, number> = { PLAY_AUTH_REQUIRED: 401, PLAY_MEMBERSHIP_REVOKED: 403,
  PLAY_INVALID_PROOF: 403, PLAY_INVALID_CHALLENGE: 403, PLAY_RATE_LIMITED: 429 };
Deno.serve(request => handlePlayAdmission(request, {
  async authenticate(req) {
    if (Deno.env.get("SUPABASE_URL") !== "https://lehjmbgfpoemqcwxowbx.supabase.co") {
      throw new PlayAdmissionError("PLAY_NOT_CONFIGURED", 503);
    }
    if (!req.headers.get("authorization")?.startsWith("Bearer ")) {
      throw new PlayAdmissionError("PLAY_AUTH_REQUIRED", 401);
    }
    const { data: { user }, error } = await authenticatedClient(req).auth.getUser();
    if (error || !user || !user.identities?.some(identity => identity.provider === "kakao")) {
      throw new PlayAdmissionError("PLAY_AUTH_REQUIRED", 401);
    }
    return user.id;
  },
  policy() { return playPolicy(Deno.env.get("PLAY_ADMISSION_CERTIFICATES"), Deno.env.get("PLAY_ADMISSION_VERSIONS")); },
  async rpc(name, args) {
    const { data, error } = await serviceClient().rpc(name, args);
    if (error) {
      const status = failures[error.message];
      if (status) throw new PlayAdmissionError(error.message, status);
      // Closed diagnostic category; do not log SQL, credentials or user identifiers.
      console.error("PLAY_ADMISSION_STORAGE_FAILED");
      throw new PlayAdmissionError("PLAY_TEMPORARY", 503);
    }
    return data;
  },
  async decode(token, packageName) {
    decoder ??= googlePlayDecoder(Deno.env.get("PLAY_ADMISSION_SERVICE_ACCOUNT") ?? "", Deno.env.get("PLAY_ADMISSION_PROJECT_ID") ?? "");
    return await decoder(token, packageName);
  },
  now: Date.now,
}));
