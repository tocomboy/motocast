import { handlePlayAdmission } from "./play-admission-handler.ts";
import { googlePlayDecoder, PlayAdmissionError, playPolicy } from "./play-integrity.ts";

type PlayAdmissionRuntime = {
  env: (name: string) => string | undefined;
  getUser: (request: Request) => Promise<{
    data: { user: { id: string; identities?: { provider: string }[] } | null };
    error: unknown;
  }>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<{
    data: unknown; error: { message: string } | null;
  }>;
  decoder?: typeof googlePlayDecoder;
  now?: () => number;
};
const failures: Record<string, number> = { PLAY_AUTH_REQUIRED: 401, PLAY_MEMBERSHIP_REVOKED: 403,
  PLAY_INVALID_PROOF: 403, PLAY_INVALID_CHALLENGE: 403, PLAY_RATE_LIMITED: 429 };

/** The deployed entrypoint's runtime boundary; request URL/headers cannot select a project. */
export function createPlayAdmissionRuntime(runtime: PlayAdmissionRuntime) {
  let decoder: ReturnType<typeof googlePlayDecoder> | undefined;
  return (request: Request) => handlePlayAdmission(request, {
    async authenticate(req) {
      const environment = runtime.env("PLAY_ADMISSION_ENVIRONMENT");
      const url = runtime.env("SUPABASE_URL");
      if (!((environment === "preview" && url === "https://lehjmbgfpoemqcwxowbx.supabase.co") ||
        (environment === "production" && url === "https://obodvbyzptxeehgpcpkd.supabase.co"))) {
        throw new PlayAdmissionError("PLAY_NOT_CONFIGURED", 503);
      }
      if (!req.headers.get("authorization")?.startsWith("Bearer ")) {
        throw new PlayAdmissionError("PLAY_AUTH_REQUIRED", 401);
      }
      const { data: { user }, error } = await runtime.getUser(req);
      if (error || !user || !user.identities?.some(identity => identity.provider === "kakao")) {
        throw new PlayAdmissionError("PLAY_AUTH_REQUIRED", 401);
      }
      return user.id;
    },
    policy() {
      return playPolicy(runtime.env("PLAY_ADMISSION_CERTIFICATES"), runtime.env("PLAY_ADMISSION_VERSIONS"));
    },
    async rpc(name, args) {
      const { data, error } = await runtime.rpc(name, args);
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
      decoder ??= (runtime.decoder ?? googlePlayDecoder)(runtime.env("PLAY_ADMISSION_SERVICE_ACCOUNT") ?? "",
        runtime.env("PLAY_ADMISSION_PROJECT_ID") ?? "");
      return await decoder(token, packageName);
    },
    now: runtime.now ?? Date.now,
  });
}
