"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { withClientTimeout } from "@/lib/planner/client-timeout";
import { favoritePlacePayload } from "@/lib/places/favorites";
import type { SavedPlaceKind } from "@/lib/places/saved";
import type { PlaceSearchResult } from "@/lib/places/search";
import {
  parseAvoidedPlace,
  parseFolderMember,
  parseFolderPreference,
  parsePlaceFolder,
  parseSharedPlace,
  parseStarEntries,
  PLACE_FOLDER_LIMIT,
  serverCode,
  SHARED_PLACE_PAGE_SIZE,
  type AvoidedPlace,
  type FolderMember,
  type FolderPreference,
  type PendingCreate,
  type PlaceFolder,
  type SharedPlace,
  type StarEntry,
} from "@/lib/places/shared-folders";
import { SAVED_PLACE_READ_TIMEOUT_MS, SAVED_PLACE_WRITE_TIMEOUT_MS } from "./saved-places-provider";
import type { ConfirmWrite, Recheck } from "./confirm-popup";

type State = "loading" | "ready" | "error";
/** Everything the folder screens read in one refresh. Stars and avoided places are personal. */
export type SharedSnapshot = {
  userId: string | null;
  folders: PlaceFolder[];
  members: FolderMember[];
  preferences: FolderPreference[];
  places: SharedPlace[];
  stars: StarEntry[];
  avoided: AvoidedPlace[];
};
export type SharedWrite = ConfirmWrite<SharedSnapshot>;
/** A server refusal the screen explains in its own words; `null` keeps the default text. */
export type Refusal = { reason: "rejected" | "star_limit"; title: string; message: string; stale?: boolean };
type WriteSpec = {
  rpc: string;
  args: Record<string, unknown>;
  success: string;
  /** Turns the reply into a check the re-read snapshot must pass; throwing means no receipt. */
  receipt: (data: unknown) => (snapshot: SharedSnapshot) => boolean;
  /** What the snapshot shows once the write landed; used when the result is unknown. */
  applied: (snapshot: SharedSnapshot) => boolean;
  unknownMessage: string;
  refusal?: (code: string) => Refusal | null;
};

const empty: SharedSnapshot = { userId: null, folders: [], members: [], preferences: [], places: [], stars: [], avoided: [] };
/** Stars ahead of the 10 limit are a server invariant; more than this is a broken read. */
const MAX_SHARED_ROWS = PLACE_FOLDER_LIMIT * SHARED_PLACE_PAGE_SIZE;

type Controls = {
  accountEpoch: number;
  enabled: boolean;
  status: State;
  snapshot: SharedSnapshot;
  busy: boolean;
  verifying: boolean;
  message: string;
  current: () => { status: State; snapshot: SharedSnapshot };
  retry: () => void;
  refresh: () => Promise<SharedSnapshot | null>;
  /** Re-reads only my stars, after a personal star changed in the saved-places provider. */
  reloadStars: () => Promise<void>;
  captureSnapshot: () => () => boolean;
  recheck: (applied: (snapshot: SharedSnapshot) => boolean) => Promise<Recheck>;
  write: (spec: WriteSpec) => Promise<SharedWrite>;
  /** Plain RPC without a list receipt (invite reads and creation). */
  call: (rpc: string, args: Record<string, unknown>) => Promise<{ data: unknown; code: string | null; lost: boolean }>;
  /**
   * A folder create with an unknown result, kept for this account across screens (not across
   * reloads): new creates wait until a read settles it; only the same request may be resent.
   */
  pendingCreate: PendingCreate | null;
  setPendingCreate: (pending: PendingCreate | null) => void;
};
const Context = createContext<Controls | null>(null);

async function readAll(): Promise<SharedSnapshot> {
  const client = getBrowserSupabase();
  if (!client) throw new Error("UNAVAILABLE");
  const read = <T,>(query: PromiseLike<{ data: unknown; error: unknown }>, parse: (rows: unknown) => T) =>
    withClientTimeout(query, SAVED_PLACE_READ_TIMEOUT_MS).then(({ data, error }) => {
      if (error) throw new Error("READ_FAILED");
      return parse(data);
    });
  const rows = <T,>(parse: (row: unknown) => T, max: number) => (data: unknown) => {
    if (!Array.isArray(data) || data.length > max) throw new Error("READ_FAILED");
    return data.map(parse);
  };
  const [session, folders, members, preferences, stars, avoided] = await Promise.all([
    client.auth.getSession().then(({ data }: { data: { session: Session | null } }) => data.session?.user.id ?? null),
    read(client.from("place_folders").select("id,owner_id,name,revision,create_request_id,created_at,updated_at").order("created_at").order("id"), rows(parsePlaceFolder, PLACE_FOLDER_LIMIT)),
    read(client.from("place_folder_members").select("folder_id,member_id,role,display_name,joined_at,revision").order("folder_id").order("joined_at").order("member_id"), rows(parseFolderMember, PLACE_FOLDER_LIMIT * 30)),
    read(client.from("place_folder_preferences").select("member_id,folder_id,enabled,updated_at").order("folder_id"), rows(parseFolderPreference, PLACE_FOLDER_LIMIT)),
    read(client.from("my_star_entries").select("source,id,folder_id,place,alias,kind,province,revision,starred_at"), (data) => parseStarEntries(data)),
    read(client.from("avoided_places").select("id,place,source_shared_place_id,created_at").order("created_at").order("id"), rows(parseAvoidedPlace, 200)),
  ]);
  // Every page of every folder: the list is never cut at the first 1,000 rows.
  const places: SharedPlace[] = [];
  const seen = new Set<string>();
  for (let from = 0; ; from += SHARED_PLACE_PAGE_SIZE) {
    const page = await read(
      client
        .from("shared_place_entries")
        .select("id,folder_id,place,alias,kind,province,revision,created_by,updated_by,created_at,updated_at,updated_by_display_name,updated_by_left,starred")
        .order("folder_id")
        .order("created_at")
        .order("id")
        .range(from, from + SHARED_PLACE_PAGE_SIZE - 1),
      rows(parseSharedPlace, SHARED_PLACE_PAGE_SIZE),
    );
    for (const row of page) if (!seen.has(row.id)) { seen.add(row.id); places.push(row); }
    if (page.length < SHARED_PLACE_PAGE_SIZE) break;
    if (places.length > MAX_SHARED_ROWS) throw new Error("READ_FAILED");
  }
  const folderIds = new Set(folders.map((folder) => folder.id));
  // One refresh must describe one set of folders; a row for an unknown folder means the
  // pages straddled a membership change, so the read is retried rather than shown.
  if (
    places.some((row) => !folderIds.has(row.folderId)) ||
    members.some((row) => !folderIds.has(row.folderId)) ||
    preferences.some((row) => !folderIds.has(row.folderId))
  )
    throw new Error("READ_INCONSISTENT");
  return { userId: session, folders, members, preferences, places, stars, avoided };
}

export function SharedFoldersProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const [snapshot, setSnapshot] = useState<SharedSnapshot>(empty);
  const [status, setStatus] = useState<State>(enabled ? "loading" : "ready");
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState("");
  const [accountEpoch, setAccountEpoch] = useState(0);
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const mounted = useRef(false);
  const generation = useRef(0);
  const session = useRef(0);
  const user = useRef<string | null | undefined>(undefined);
  const operation = useRef<symbol | null>(null);
  const statusRef = useRef<State>(status);
  const snapshotRef = useRef<SharedSnapshot>(snapshot);

  const load = useCallback(async (owner?: symbol): Promise<SharedSnapshot | null> => {
    if (operation.current && operation.current !== owner) return null;
    if (!enabled) return null;
    const read = ++generation.current;
    const epoch = session.current;
    setStatus("loading");
    statusRef.current = "loading";
    const current = () => mounted.current && read === generation.current && epoch === session.current;
    try {
      let next: SharedSnapshot;
      try {
        next = await readAll();
      } catch (error) {
        // A read that straddled a membership change is read once more before failing.
        if (!(error instanceof Error) || error.message !== "READ_INCONSISTENT" || !current()) throw error;
        next = await readAll();
      }
      if (!current()) return null;
      snapshotRef.current = next;
      statusRef.current = "ready";
      setSnapshot(next);
      setStatus("ready");
      return next;
    } catch {
      if (current()) {
        generation.current++;
        statusRef.current = "error";
        setStatus("error");
      }
      return null;
    }
  }, [enabled]);

  useEffect(() => {
    mounted.current = true;
    const task = window.setTimeout(() => void load(), 0);
    const client = getBrowserSupabase();
    const subscription = enabled && client?.auth
      ? client.auth.onAuthStateChange((_event: AuthChangeEvent, next: Session | null) => {
          const id = next?.user.id ?? null;
          if (user.current === id) return;
          const first = user.current === undefined;
          user.current = id;
          if (first) return;
          session.current++;
          generation.current++;
          operation.current = null;
          setAccountEpoch(session.current);
          snapshotRef.current = empty;
          setSnapshot(empty);
          // Another account (or none) never inherits a kept create.
          setPendingCreate(null);
          setBusy(false);
          setVerifying(false);
          setMessage("");
          if (id) window.setTimeout(() => { if (mounted.current) void load(); }, 0);
          else { statusRef.current = "error"; setStatus("error"); }
        }).data.subscription
      : null;
    return () => {
      mounted.current = false;
      session.current += 1;
      generation.current += 1;
      operation.current = null;
      window.clearTimeout(task);
      subscription?.unsubscribe();
    };
  }, [enabled, load]);

  const write = useCallback(async (spec: WriteSpec): Promise<SharedWrite> => {
    const client = getBrowserSupabase();
    if (!enabled || !client || operation.current || statusRef.current !== "ready")
      return { ok: false, reason: "blocked", title: "지금은 변경할 수 없어요", message: "목록을 확인한 뒤 다시 시도해 주세요." };
    const id = Symbol();
    operation.current = id;
    const epoch = session.current;
    generation.current++;
    setBusy(true);
    const current = () => mounted.current && epoch === session.current && operation.current === id;
    const gone: SharedWrite = { ok: false, reason: "blocked", title: "계정이 바뀌었어요", message: "최신 목록을 다시 확인해 주세요." };
    const finish = () => {
      if (operation.current === id) {
        operation.current = null;
        if (mounted.current && epoch === session.current) setBusy(false);
      }
    };
    const succeed = (): SharedWrite => { setMessage(spec.success); return { ok: true }; };
    // FP39a: no readable result, so a fresh read decides; nothing is resent.
    const verify = async (): Promise<SharedWrite> => {
      setVerifying(true);
      let fresh: SharedSnapshot | null;
      try { fresh = await load(id); } finally { if (mounted.current && epoch === session.current) setVerifying(false); }
      if (!current()) return gone;
      if (fresh && spec.applied(fresh)) return succeed();
      return fresh
        ? { ok: false, reason: "unknown", checked: true, title: "변경을 확인하지 못했어요", message: spec.unknownMessage, recheck: spec.applied }
        : { ok: false, reason: "unknown", checked: false, title: "목록을 확인하지 못했어요", message: "변경됐는지 아직 몰라요. 목록을 다시 확인한 뒤에 다시 시도할 수 있어요.", recheck: spec.applied };
    };
    try {
      let response: { data: unknown; error: { message: string } | null };
      try {
        response = await withClientTimeout<{ data: unknown; error: { message: string } | null }>(client.rpc(spec.rpc, spec.args), SAVED_PLACE_WRITE_TIMEOUT_MS);
      } catch {
        if (!current()) return gone;
        return await verify();
      }
      if (!current()) return gone;
      if (response.error) {
        const code = serverCode(response.error.message);
        const refusal = code ? spec.refusal?.(code) ?? defaultRefusal(code) : null;
        if (!refusal) return await verify();
        const fresh = await load(id);
        if (!current()) return gone;
        return { ok: false, ...refusal, message: `${refusal.message}${fresh ? "" : " 최신 목록도 확인하지 못했어요."}` };
      }
      let shows: (snapshot: SharedSnapshot) => boolean;
      try { shows = spec.receipt(response.data); } catch { return await verify(); }
      let readable = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        const fresh = await load(id);
        if (!current()) return gone;
        if (!fresh) continue;
        readable = true;
        if (shows(fresh)) return succeed();
      }
      return {
        ok: false,
        reason: "mismatch",
        checked: readable,
        // Memo 379:12472: the same words after each read-only re-check that still does not show it.
        title: MISMATCH_COPY.title,
        message: MISMATCH_COPY.message,
        recheck: shows,
        stillMissing: MISMATCH_COPY,
      };
    } finally {
      finish();
    }
  }, [enabled, load]);

  const recheck = useCallback(async (applied: (snapshot: SharedSnapshot) => boolean): Promise<Recheck> => {
    if (!enabled || operation.current) return "unreadable";
    const id = Symbol();
    operation.current = id;
    const epoch = session.current;
    setBusy(true);
    try {
      const fresh = await load(id);
      if (!mounted.current || epoch !== session.current || operation.current !== id || !fresh) return "unreadable";
      return applied(fresh) ? "applied" : "missing";
    } finally {
      if (operation.current === id) {
        operation.current = null;
        if (mounted.current && epoch === session.current) setBusy(false);
      }
    }
  }, [enabled, load]);

  const call = useCallback(async (rpc: string, args: Record<string, unknown>) => {
    const client = getBrowserSupabase();
    if (!enabled || !client) return { data: null, code: "UNAVAILABLE", lost: false };
    try {
      const { data, error } = await withClientTimeout<{ data: unknown; error: { message: string } | null }>(client.rpc(rpc, args), SAVED_PLACE_WRITE_TIMEOUT_MS);
      if (error) {
        const code = serverCode(error.message);
        return { data: null, code, lost: !code || !KNOWN_CODES.has(code) };
      }
      return { data, code: null, lost: false };
    } catch {
      return { data: null, code: null, lost: true };
    }
  }, [enabled]);

  // Stable across status changes: screens re-read on entry with an effect keyed on this function.
  const refresh = useCallback(() => load(), [load]);

  const reloadStars = useCallback(async () => {
    const client = getBrowserSupabase();
    if (!enabled || !client || operation.current || statusRef.current !== "ready") return;
    const epoch = session.current;
    const read = generation.current;
    try {
      const { data, error } = await withClientTimeout<{ data: unknown; error: unknown }>(
        client.from("my_star_entries").select("source,id,folder_id,place,alias,kind,province,revision,starred_at"),
        SAVED_PLACE_READ_TIMEOUT_MS,
      );
      if (error) throw new Error("READ_FAILED");
      const stars = parseStarEntries(data);
      // A full refresh started meanwhile owns the snapshot.
      if (!mounted.current || epoch !== session.current || read !== generation.current || operation.current) return;
      snapshotRef.current = { ...snapshotRef.current, stars };
      setSnapshot(snapshotRef.current);
    } catch {
      // The star list keeps its last good value; the next full refresh replaces it.
    }
  }, [enabled]);

  const captureSnapshot = useCallback(() => {
    const read = generation.current;
    const epoch = session.current;
    return () => mounted.current && read === generation.current && epoch === session.current;
  }, []);

  const value = useMemo<Controls>(() => ({
    accountEpoch,
    enabled,
    status,
    snapshot,
    busy,
    verifying,
    message,
    current: () => ({ status: statusRef.current, snapshot: snapshotRef.current }),
    retry: () => { void load(); },
    refresh,
    reloadStars,
    captureSnapshot,
    recheck,
    write,
    call,
    pendingCreate,
    setPendingCreate,
  }), [accountEpoch, enabled, status, snapshot, busy, verifying, message, load, refresh, reloadStars, captureSnapshot, recheck, write, call, pendingCreate]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

const KNOWN_CODES = new Set([
  "MEMBERSHIP_REQUIRED", "PLACE_FOLDER_LIMIT", "PLACE_FOLDER_MEMBER_LIMIT", "PLACE_FOLDER_PLACE_LIMIT", "PLACE_FOLDER_INVITE_LIMIT",
  "AVOIDED_PLACE_LIMIT", "SAVED_PLACE_STAR_LIMIT", "INVALID_PLACE_FOLDER", "INVALID_FOLDER_DISPLAY_NAME", "FOLDER_DISPLAY_NAME_TAKEN",
  "PLACE_FOLDER_INVITE_INVALID", "PLACE_FOLDER_NOT_FOUND", "SHARED_PLACE_NOT_FOUND", "PLACE_FOLDER_INVITE_NOT_FOUND", "PLACE_FOLDER_FORBIDDEN",
  "PLACE_FOLDER_STALE", "PLACE_FOLDER_MEMBER_STALE", "SHARED_PLACE_STALE", "PLACE_FOLDER_MEMBER_NOT_FOUND", "INVALID_PLACE_FOLDER_ROLE",
  "INVALID_PLACE_FOLDER_PREFERENCES", "AVOIDED_PLACE_NOT_FOUND", "PLACE_FOLDER_WRITE_CONFLICT", "PLACE_FOLDER_OWNER_CANNOT_LEAVE",
  "INVALID_SAVED_PLACE", "INVALID_SAVED_PLACE_METADATA", "SAVED_PLACE_NOT_FOUND", "PLACE_FOLDER_REQUEST_MISMATCH",
]);

/** Fallback wording for a clear refusal; screens pass their own text for the codes they expect. */
/** A committed change the re-read list does not show yet (memo 379:12472). */
export const MISMATCH_COPY = { title: "변경이 목록에 아직 보이지 않아요", message: "변경은 저장됐지만 목록에 아직 반영되지 않았어요. 변경은 다시 보내지 않아요. 잠시 뒤 목록을 다시 확인해 주세요." };

function defaultRefusal(code: string): Refusal | null {
  if (!KNOWN_CODES.has(code)) return null;
  if (code === "SAVED_PLACE_STAR_LIMIT")
    return { reason: "star_limit", title: "자주 찾는 장소에 추가하지 못했어요", message: "이미 10곳이 별표돼 있어요. 다른 기기에서 먼저 추가했을 수 있어요." };
  if (code.endsWith("_STALE"))
    return { reason: "rejected", stale: true, title: "다른 곳에서 먼저 바뀌었어요", message: "최신 내용을 불러왔어요. 확인한 뒤 다시 시도해 주세요." };
  if (code.endsWith("_NOT_FOUND"))
    return { reason: "rejected", stale: true, title: "찾지 못했어요", message: "이미 삭제됐거나 더 볼 수 없어요. 최신 목록을 불러왔어요." };
  if (code === "PLACE_FOLDER_FORBIDDEN")
    return { reason: "rejected", title: "권한이 없어요", message: "지금 권한으로는 할 수 없어요. 최신 권한을 불러왔어요." };
  if (code === "MEMBERSHIP_REQUIRED")
    return { reason: "rejected", title: "로그인이 필요해요", message: "다시 로그인한 뒤 시도해 주세요." };
  return { reason: "rejected", title: "요청이 거부됐어요", message: "입력 내용과 한도를 확인한 뒤 다시 시도해 주세요." };
}

export function useSharedFolders() {
  const value = useContext(Context);
  if (!value) throw new Error("SHARED_FOLDERS_PROVIDER_REQUIRED");
  return value;
}

/** Shared-place payload: the stored place, signature included, copied unchanged. */
export const sharedPlacePayload = (place: PlaceSearchResult) => ({ ...favoritePlacePayload(place), roadAddress: place.roadAddress });

export type SharedPlaceDraft = { place: PlaceSearchResult; alias: string; kind: SavedPlaceKind };
