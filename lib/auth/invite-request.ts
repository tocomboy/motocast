export function isTrustedInviteAcceptanceRequest(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") return false;
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") return false;

  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}
