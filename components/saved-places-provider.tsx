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
import {
  favoritePlacePayload,
  type PlaceFavorite,
} from "@/lib/places/favorites";
import {
  parseSavedPlace,
  parseSavedPlaces,
  savedAsFavorite,
  type SavedPlace,
  type SavedPlaceKind,
} from "@/lib/places/saved";
import type { PlaceSearchResult } from "@/lib/places/search";

type State = "loading" | "ready" | "error";
type SavedPlacesControls = {
  accountEpoch: number;
  places: SavedPlace[];
  favorites: PlaceFavorite[];
  status: State;
  busy: boolean;
  message: string;
  retry: () => void;
  captureSnapshot: () => () => boolean;
  save: (
    place: PlaceSearchResult,
    alias: string,
    kind: SavedPlaceKind,
    starred: boolean,
  ) => Promise<boolean>;
  edit: (
    place: SavedPlace,
    alias: string,
    kind: SavedPlaceKind,
  ) => Promise<boolean>;
  star: (place: SavedPlace, starred: boolean) => Promise<boolean>;
  deletePlace: (place: SavedPlace) => Promise<boolean>;
  add: (place: PlaceSearchResult) => Promise<boolean>;
  remove: (place: PlaceFavorite) => Promise<boolean>;
};
const Context = createContext<SavedPlacesControls | null>(null);

export function SavedPlacesProvider({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  const [status, setStatus] = useState<State>(enabled ? "loading" : "ready");
  const [busy, setBusy] = useState(false);
  const [accountEpoch, setAccountEpoch] = useState(0);
  const [message, setMessage] = useState(
    enabled ? "" : "데모 모드에서는 저장 장소를 저장하지 않습니다.",
  );
  const mounted = useRef(false);
  const generation = useRef(0);
  const session = useRef(0);
  const user = useRef<string | null | undefined>(undefined);
  const operation = useRef<symbol | null>(null);

  const load = useCallback(
    async (owner?: symbol) => {
      if (operation.current && operation.current !== owner) return false;
      const read = ++generation.current;
      const epoch = session.current;
      if (!enabled) return false;
      setStatus("loading");
      try {
        const client = getBrowserSupabase();
        if (!client) throw new Error("UNAVAILABLE");
        const { data, error } = await client
          .from("saved_places")
          .select(
            "id,place,alias,kind,province,star_slot,revision,created_at,updated_at",
          )
          .order("created_at")
          .limit(1001);
        if (
          !mounted.current ||
          read !== generation.current ||
          epoch !== session.current
        )
          return false;
        if (error) throw new Error("READ_FAILED");
        setPlaces(parseSavedPlaces(data));
        setStatus("ready");
        setMessage("");
        return true;
      } catch {
        if (
          mounted.current &&
          read === generation.current &&
          epoch === session.current
        ) {
          setPlaces([]);
          setStatus("error");
          setMessage(
            "저장한 장소를 확인하지 못했어요. 목록을 다시 확인해 주세요.",
          );
        }
        return false;
      }
    },
    [enabled],
  );

  useEffect(() => {
    mounted.current = true;
    const task = window.setTimeout(() => void load(), 0);
    const client = getBrowserSupabase();
    const subscription =
      enabled && client?.auth
        ? client.auth.onAuthStateChange(
            (_event: AuthChangeEvent, next: Session | null) => {
              const id = next?.user.id ?? null;
              if (user.current === id) return;
              user.current = id;
              session.current++;
              generation.current++;
              operation.current = null;
              setAccountEpoch(session.current);
              setPlaces([]);
              setBusy(false);
              if (id) {
                window.setTimeout(() => {
                  if (mounted.current) void load();
                }, 0);
              } else {
                setStatus("error");
                setMessage("로그인 후 저장한 장소를 다시 확인해 주세요.");
              }
            },
          ).data.subscription
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

  const mutate = useCallback(
    async (
      name: string,
      args: Record<string, unknown>,
      success: string,
      deletes = false,
    ) => {
      const client = getBrowserSupabase();
      if (!enabled || !client || operation.current || status !== "ready")
        return false;
      const id = Symbol();
      operation.current = id;
      const epoch = session.current;
      generation.current++;
      setBusy(true);
      const current = () =>
        mounted.current &&
        epoch === session.current &&
        operation.current === id;
      try {
        const { data, error } = await client.rpc(name, args);
        if (!current()) return false;
        if (error) {
          const reason = error.message.includes("LIMIT")
            ? error.message.includes("STAR") ||
              error.message.includes("FAVORITE")
              ? "자주 찾는 곳은 최대 5개예요. 먼저 다른 장소의 별표를 해제해 주세요."
              : "저장 장소는 합계 1,000개까지예요. 기존 장소를 정리해 주세요."
            : error.message.includes("STALE") ||
                error.message.includes("NOT_FOUND")
              ? "다른 곳에서 목록이 바뀌었어요. 최신 장소를 다시 선택해 주세요."
              : "변경 결과를 확인하지 못했어요. 최신 목록을 확인한 뒤 다시 선택해 주세요.";
          const checked = await load(id);
          if (current())
            setMessage(
              `${reason}${checked ? "" : " 최신 목록도 확인하지 못했어요."}`,
            );
          return false;
        }
        if (!deletes)
          parseSavedPlace(
            Array.isArray(data) && data.length === 1 ? data[0] : null,
          );
        const checked = await load(id);
        if (!current() || !checked) return false;
        setMessage(success);
        return true;
      } catch {
        if (current()) {
          const checked = await load(id);
          if (current())
            setMessage(
              checked
                ? "변경 결과가 불확실해 최신 목록을 다시 확인했어요. 자동으로 재시도하지 않았습니다."
                : "변경 결과와 최신 목록을 확인하지 못했어요.",
            );
        }
        return false;
      } finally {
        if (operation.current === id) {
          operation.current = null;
          if (mounted.current && epoch === session.current) setBusy(false);
        }
      }
    },
    [enabled, load, status],
  );

  const star = useCallback(
    (place: SavedPlace, starred: boolean) =>
      mutate(
        "set_saved_place_star",
        {
          saved_place_id: place.id,
          expected_revision: place.revision,
          starred,
        },
        starred
          ? "자주 찾는 곳에 추가했어요."
          : "별표를 해제했어요. 저장한 장소는 그대로 남아 있어요.",
      ),
    [mutate],
  );
  const save = useCallback(
    (
      place: PlaceSearchResult,
      alias: string,
      kind: SavedPlaceKind,
      starred: boolean,
    ) =>
      mutate(
        "save_place",
        {
          saved_place: {
            ...favoritePlacePayload(place),
            roadAddress: place.roadAddress,
          },
          place_alias: alias.trim() || null,
          place_kind: kind,
          starred,
        },
        "저장한 장소를 확인했어요. 이미 저장한 장소의 정보는 유지됩니다.",
      ),
    [mutate],
  );
  const captureSnapshot = useCallback(() => {
    const read = generation.current;
    const epoch = session.current;
    return () =>
      mounted.current &&
      read === generation.current &&
      epoch === session.current;
  }, []);
  const value = useMemo<SavedPlacesControls>(
    () => ({
      accountEpoch,
      places,
      status,
      busy,
      message,
      retry: () => {
        void load();
      },
      captureSnapshot,
      save,
      star,
      favorites: places
        .filter((p) => p.starSlot !== null)
        .sort((a, b) => a.starSlot! - b.starSlot!)
        .map(savedAsFavorite),
      edit: (p, alias, kind) =>
        mutate(
          "update_saved_place",
          {
            saved_place_id: p.id,
            expected_revision: p.revision,
            place_alias: alias.trim() || null,
            place_kind: kind,
          },
          "장소 정보를 수정했어요.",
        ),
      deletePlace: (p) =>
        mutate(
          "delete_saved_place",
          { saved_place_id: p.id, expected_revision: p.revision },
          "선택한 장소를 삭제했어요. 기존 코스와 공유 결과는 유지됩니다.",
          true,
        ),
      add: (p) => {
        const existing = places.find(
          (row) => row.place.kakaoPlaceId === p.kakaoPlaceId,
        );
        return existing
          ? star(existing, true)
          : save(p, "", "riding_spot", true);
      },
      remove: (p) => {
        const existing = places.find(
          (row) =>
            row.place.kakaoPlaceId === p.place.kakaoPlaceId &&
            row.starSlot === p.slot,
        );
        return existing ? star(existing, false) : Promise.resolve(false);
      },
    }),
    [
      accountEpoch,
      places,
      status,
      busy,
      message,
      load,
      captureSnapshot,
      save,
      star,
      mutate,
    ],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSavedPlaces() {
  const value = useContext(Context);
  if (!value) throw new Error("SAVED_PLACES_PROVIDER_REQUIRED");
  return value;
}
