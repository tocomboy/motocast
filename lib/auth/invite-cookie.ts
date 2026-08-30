const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function isInviteToken(value: string): boolean {
  return INVITE_TOKEN_PATTERN.test(value);
}

export function inviteTokenFromCookieHeader(cookieHeader: string | null): string | null {
  const encoded = (cookieHeader ?? "").match(/(?:^|;\s*)motocast_invite=([^;]+)/)?.[1];
  if (!encoded) return null;
  let token: string;
  try {
    token = decodeURIComponent(encoded);
  } catch {
    return null;
  }
  return isInviteToken(token) ? token : null;
}
