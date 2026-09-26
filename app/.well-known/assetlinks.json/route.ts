// Public Play signing certificate fingerprints, never an upload key or a secret.
// The chosen link origin must serve this publicly, without deployment-login redirects.
export const dynamic = "force-dynamic";

export function GET() {
  const configured = process.env.MOTOCAST_ANDROID_APP_LINKS_SHA256;
  const fingerprints = configured?.split(",").map((value) => value.trim());
  if (!fingerprints?.length || fingerprints.length > 10 || fingerprints.some(
    (value) => !/^(?:[A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}$/.test(value),
  )) {
    return Response.json({ error: "Android app links are not configured." }, {
      status: 503,
      headers: { "cache-control": "no-store", "retry-after": "300" },
    });
  }

  return Response.json([{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: "dev.motocast.android",
      sha256_cert_fingerprints: [...new Set(fingerprints.map((value) => value.toUpperCase()))],
    },
  }], {
    headers: { "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" },
  });
}
