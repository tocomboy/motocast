export function supabaseAuthCookieNames(cookieHeader: string | null): string[] {
  return (cookieHeader ?? "")
    .split(";")
    .map((part) => part.trim().split("=", 1)[0])
    .filter((name) => /^sb-[a-z0-9]+-auth-token(?:\.\d+)?$/.test(name));
}
