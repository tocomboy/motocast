import { parseSharedRideSnapshot } from "./contracts";

export type PublicShareResolution =
  | { status: "found"; snapshot: ReturnType<typeof parseSharedRideSnapshot> }
  | { status: "not-found" }
  | { status: "unavailable" | "invalid-snapshot" };

type ShareRpcClient = {
  rpc: (name: "resolve_share", input: { share_token: string }) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

export async function resolvePublicShareWithClient(
  token: string,
  createClient: () => Promise<ShareRpcClient>,
): Promise<PublicShareResolution> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { status: "not-found" };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc("resolve_share", { share_token: token });
    if (error) {
      return error.message.includes("SHARE_NOT_FOUND")
        ? { status: "not-found" }
        : { status: "unavailable" };
    }
    if (data === null || data === undefined) return { status: "unavailable" };
    try {
      return { status: "found", snapshot: parseSharedRideSnapshot(data) };
    } catch {
      return { status: "invalid-snapshot" };
    }
  } catch {
    return { status: "unavailable" };
  }
}
