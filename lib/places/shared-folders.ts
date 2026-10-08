import { parseStoredPlace, PROVINCES, type SavedPlaceKind } from "./saved";
import type { PlaceSearchResult } from "./search";

/** Limits from the #124 contract (docs/work/2026-10-09-issue124-shared-folders-contract.md §2). */
export const PLACE_FOLDER_LIMIT = 20;
export const PLACE_FOLDER_MEMBER_LIMIT = 30;
export const PLACE_FOLDER_PLACE_LIMIT = 1000;
export const PLACE_FOLDER_INVITE_LIMIT = 10;
export const AVOIDED_PLACE_LIMIT = 200;
export const FOLDER_NAME_LIMIT = 40;
export const FOLDER_DISPLAY_NAME_LIMIT = 20;
/** Rows per page when every shared place is read (PostgREST max_rows is 1,000). */
export const SHARED_PLACE_PAGE_SIZE = 1000;

export type FolderRole = "owner" | "editor" | "viewer";
export type PlaceFolder = { id: string; ownerId: string; name: string; revision: number; createdAt: string; updatedAt: string };
export type FolderMember = { folderId: string; memberId: string; role: FolderRole; displayName: string; joinedAt: string; revision: number };
export type FolderPreference = { memberId: string; folderId: string; enabled: boolean; updatedAt: string };
export type SharedPlace = {
  id: string;
  folderId: string;
  place: PlaceSearchResult;
  alias: string | null;
  kind: SavedPlaceKind;
  province: string | null;
  revision: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  /** Null when the last editor is no longer a member ("나간 회원"). */
  updatedByDisplayName: string | null;
  updatedByLeft: boolean;
  /** My own shared star; other members never see it. */
  starred: boolean;
};
export type StarEntry = {
  source: "saved" | "shared";
  id: string;
  folderId: string | null;
  place: PlaceSearchResult;
  alias: string | null;
  kind: SavedPlaceKind;
  province: string | null;
  revision: number;
  starredAt: string;
};
export type AvoidedPlace = { id: string; place: PlaceSearchResult; sourceSharedPlaceId: string | null; createdAt: string };
export type FolderInvite = { id: string; createdAt: string; expiresAt: string; revokedAt: string | null };
export type CreatedInvite = { id: string; token: string; expiresAt: string };
export type InvitePreview = {
  status: "joinable" | "already_member";
  folderId: string | null;
  folderName: string;
  ownerDisplayName: string;
  memberCount: number;
  placeCount: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown, code: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
};
const uuid = (value: unknown, code: string) => {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(code);
  return value.toLowerCase();
};
const time = (value: unknown, code: string) => {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(code);
  return value;
};
const revision = (value: unknown, code: string) => {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 1) throw new Error(code);
  return Number(parsed);
};
const text = (value: unknown, code: string, max: number) => {
  if (typeof value !== "string" || !value || [...value].length > max || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(code);
  return value;
};
const count = (value: unknown, code: string) => {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 0) throw new Error(code);
  return Number(parsed);
};

export function parsePlaceFolder(value: unknown): PlaceFolder {
  const row = record(value, "INVALID_PLACE_FOLDER");
  return {
    id: uuid(row.id, "INVALID_PLACE_FOLDER"),
    ownerId: uuid(row.owner_id, "INVALID_PLACE_FOLDER"),
    name: text(row.name, "INVALID_PLACE_FOLDER", FOLDER_NAME_LIMIT),
    revision: revision(row.revision, "INVALID_PLACE_FOLDER"),
    createdAt: time(row.created_at, "INVALID_PLACE_FOLDER"),
    updatedAt: time(row.updated_at, "INVALID_PLACE_FOLDER"),
  };
}

export function parseFolderMember(value: unknown): FolderMember {
  const row = record(value, "INVALID_FOLDER_MEMBER");
  if (!["owner", "editor", "viewer"].includes(String(row.role))) throw new Error("INVALID_FOLDER_MEMBER");
  return {
    folderId: uuid(row.folder_id, "INVALID_FOLDER_MEMBER"),
    memberId: uuid(row.member_id, "INVALID_FOLDER_MEMBER"),
    role: row.role as FolderRole,
    displayName: text(row.display_name, "INVALID_FOLDER_MEMBER", FOLDER_DISPLAY_NAME_LIMIT),
    joinedAt: time(row.joined_at, "INVALID_FOLDER_MEMBER"),
    revision: revision(row.revision, "INVALID_FOLDER_MEMBER"),
  };
}

export function parseFolderPreference(value: unknown): FolderPreference {
  const row = record(value, "INVALID_FOLDER_PREFERENCE");
  if (typeof row.enabled !== "boolean") throw new Error("INVALID_FOLDER_PREFERENCE");
  return {
    memberId: uuid(row.member_id, "INVALID_FOLDER_PREFERENCE"),
    folderId: uuid(row.folder_id, "INVALID_FOLDER_PREFERENCE"),
    enabled: row.enabled,
    updatedAt: time(row.updated_at, "INVALID_FOLDER_PREFERENCE"),
  };
}

const metadata = (row: Record<string, unknown>, code: string) => {
  if (
    (row.alias !== null && (typeof row.alias !== "string" || !row.alias || /^ | $/.test(row.alias) || [...row.alias].length > 80 || /[\u0000-\u001f\u007f]/.test(row.alias))) ||
    !["riding_spot", "restaurant"].includes(String(row.kind)) ||
    (row.province !== null && !PROVINCES.includes(row.province as (typeof PROVINCES)[number]))
  )
    throw new Error(code);
  return { alias: row.alias as string | null, kind: row.kind as SavedPlaceKind, province: row.province as string | null };
};

/** A `shared_place_entries` row (contract §6.1). */
export function parseSharedPlace(value: unknown): SharedPlace {
  const row = record(value, "INVALID_SHARED_PLACE");
  if (typeof row.updated_by_left !== "boolean" || typeof row.starred !== "boolean") throw new Error("INVALID_SHARED_PLACE");
  const left = row.updated_by_left;
  if (left ? row.updated_by_display_name !== null : typeof row.updated_by_display_name !== "string") throw new Error("INVALID_SHARED_PLACE");
  return {
    id: uuid(row.id, "INVALID_SHARED_PLACE"),
    folderId: uuid(row.folder_id, "INVALID_SHARED_PLACE"),
    place: parseStoredPlace(row.place),
    ...metadata(row, "INVALID_SHARED_PLACE"),
    revision: revision(row.revision, "INVALID_SHARED_PLACE"),
    createdBy: uuid(row.created_by, "INVALID_SHARED_PLACE"),
    updatedBy: uuid(row.updated_by, "INVALID_SHARED_PLACE"),
    createdAt: time(row.created_at, "INVALID_SHARED_PLACE"),
    updatedAt: time(row.updated_at, "INVALID_SHARED_PLACE"),
    updatedByDisplayName: left ? null : (row.updated_by_display_name as string),
    updatedByLeft: left,
    starred: row.starred,
  };
}

/** A `my_star_entries` row. */
export function parseStarEntry(value: unknown): StarEntry {
  const row = record(value, "INVALID_STAR_ENTRY");
  if (row.source !== "saved" && row.source !== "shared") throw new Error("INVALID_STAR_ENTRY");
  const folderId = row.source === "shared" ? uuid(row.folder_id, "INVALID_STAR_ENTRY") : null;
  if (row.source === "saved" && row.folder_id !== null) throw new Error("INVALID_STAR_ENTRY");
  return {
    source: row.source,
    id: uuid(row.id, "INVALID_STAR_ENTRY"),
    folderId,
    place: parseStoredPlace(row.place),
    ...metadata(row, "INVALID_STAR_ENTRY"),
    revision: revision(row.revision, "INVALID_STAR_ENTRY"),
    starredAt: time(row.starred_at, "INVALID_STAR_ENTRY"),
  };
}

/** Stars in display order: when they were starred, then id (contract §3). */
export function parseStarEntries(rows: unknown, limit = 10): StarEntry[] {
  if (!Array.isArray(rows) || rows.length > limit) throw new Error("INVALID_STAR_ENTRIES");
  const result = rows.map(parseStarEntry);
  if (new Set(result.map((row) => `${row.source}:${row.id}`)).size !== result.length) throw new Error("INVALID_STAR_ENTRIES");
  return result.sort((a, b) => Date.parse(a.starredAt) - Date.parse(b.starredAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function parseAvoidedPlace(value: unknown): AvoidedPlace {
  const row = record(value, "INVALID_AVOIDED_PLACE");
  return {
    id: uuid(row.id, "INVALID_AVOIDED_PLACE"),
    place: parseStoredPlace(row.place),
    sourceSharedPlaceId: row.source_shared_place_id === null ? null : uuid(row.source_shared_place_id, "INVALID_AVOIDED_PLACE"),
    createdAt: time(row.created_at, "INVALID_AVOIDED_PLACE"),
  };
}

export function parseFolderInvite(value: unknown): FolderInvite {
  const row = record(value, "INVALID_FOLDER_INVITE");
  return {
    id: uuid(row.id, "INVALID_FOLDER_INVITE"),
    createdAt: time(row.created_at, "INVALID_FOLDER_INVITE"),
    expiresAt: time(row.expires_at, "INVALID_FOLDER_INVITE"),
    revokedAt: row.revoked_at === null ? null : time(row.revoked_at, "INVALID_FOLDER_INVITE"),
  };
}

export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** `create_place_folder_invite` returns exactly `{id, token, expires_at}`; the token appears only here. */
export function parseCreatedInvite(value: unknown): CreatedInvite {
  const row = record(value, "INVALID_FOLDER_INVITE");
  if (Object.keys(row).sort().join() !== "expires_at,id,token" || typeof row.token !== "string" || !INVITE_TOKEN_PATTERN.test(row.token))
    throw new Error("INVALID_FOLDER_INVITE");
  return { id: uuid(row.id, "INVALID_FOLDER_INVITE"), token: row.token, expiresAt: time(row.expires_at, "INVALID_FOLDER_INVITE") };
}

export function parseInvitePreview(value: unknown): InvitePreview {
  const row = record(value, "INVALID_INVITE_PREVIEW");
  if (row.status !== "joinable" && row.status !== "already_member") throw new Error("INVALID_INVITE_PREVIEW");
  return {
    status: row.status,
    folderId: row.status === "already_member" ? uuid(row.folder_id, "INVALID_INVITE_PREVIEW") : null,
    folderName: text(row.folder_name, "INVALID_INVITE_PREVIEW", FOLDER_NAME_LIMIT),
    ownerDisplayName: text(row.owner_display_name, "INVALID_INVITE_PREVIEW", FOLDER_DISPLAY_NAME_LIMIT),
    memberCount: count(row.member_count, "INVALID_INVITE_PREVIEW"),
    placeCount: count(row.place_count, "INVALID_INVITE_PREVIEW"),
  };
}

/** Folder and display names: trimmed, 1..max characters, no control characters (contract §2). */
export function nameProblem(value: string, max: number): "empty" | "long" | "invalid" | null {
  const trimmed = value.trim();
  if (!trimmed) return "empty";
  if ([...trimmed].length > max) return "long";
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return "invalid";
  return null;
}

/** Server codes are matched exactly; anything unrecognized is an unknown result (FP39). */
export function serverCode(message: string | undefined): string | null {
  const match = /\b([A-Z][A-Z0-9_]{3,})\b/.exec(message ?? "");
  return match ? match[1] : null;
}
