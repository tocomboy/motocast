"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

import { favoritePlacePayload, parsePlaceFavorite, type PlaceFavorite } from "@/lib/places/favorites";
import type { PlaceSearchResult } from "@/lib/places/search";
import { getBrowserSupabase } from "@/lib/supabase/browser";

type FavoriteState = "loading" | "ready" | "error";
type FavoriteContextValue = {
  favorites: PlaceFavorite[];
  status: FavoriteState;
  busy: boolean;
  message: string;
  retry: () => void;
  add: (place: PlaceSearchResult) => Promise<boolean>;
  remove: (favorite: PlaceFavorite) => Promise<boolean>;
};

const PlaceFavoritesContext = createContext<FavoriteContextValue | null>(null);

export function PlaceFavoritesProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const [favorites, setFavorites] = useState<PlaceFavorite[]>([]);
  const [status, setStatus] = useState<FavoriteState>(enabled ? "loading" : "ready");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(enabled ? "즐겨찾기를 불러오는 중입니다." : "데모 모드에서는 즐겨찾기를 저장하지 않습니다.");
  const mountedRef = useRef(false);
  const readGenerationRef = useRef(0);
  const sessionGenerationRef = useRef(0);
  const mutationSerialRef = useRef(0);
  const mutationRef = useRef<{ id: number; session: number } | null>(null);
  const userIdRef = useRef<string | null | undefined>(undefined);

  const load = useCallback(async (operation?: { id: number; session: number }) => {
    if (mutationRef.current && (!operation || mutationRef.current.id !== operation.id || mutationRef.current.session !== operation.session)) return false;
    const read = ++readGenerationRef.current;
    const session = sessionGenerationRef.current;
    if (!enabled) {
      setFavorites([]);
      setStatus("ready");
      return false;
    }
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setFavorites([]);
      setStatus("error");
      setMessage("즐겨찾기 연결을 확인할 수 없습니다. 장소 검색은 계속 사용할 수 있습니다.");
      return false;
    }
    setStatus("loading");
    try {
      const { data, error } = await supabase.from("place_favorites").select("slot,place,created_at").order("slot");
      if (!mountedRef.current || read !== readGenerationRef.current || session !== sessionGenerationRef.current) return false;
      if (error || !Array.isArray(data)) throw new Error("FAVORITE_READ_FAILED");
      const parsed = data.map(parsePlaceFavorite);
      if (new Set(parsed.map((favorite) => favorite.slot)).size !== parsed.length || parsed.length > 3) throw new Error("INVALID_PLACE_FAVORITES");
      setFavorites(parsed);
      setStatus("ready");
      setMessage(parsed.length ? `즐겨찾기 ${parsed.length}/3` : "저장한 즐겨찾기가 없습니다.");
      return true;
    } catch {
      if (mountedRef.current && read === readGenerationRef.current && session === sessionGenerationRef.current) {
        setFavorites([]);
        setStatus("error");
        setMessage("즐겨찾기를 불러오지 못했습니다. 장소 검색은 계속 사용할 수 있습니다.");
      }
      return false;
    }
  }, [enabled]);

  useEffect(() => {
    mountedRef.current = true;
    const supabase = getBrowserSupabase();
    const task = window.setTimeout(() => void load(), 0);
    const subscription = enabled && supabase && supabase.auth ? supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      const nextUserId = session?.user.id ?? null;
      if (userIdRef.current === undefined) {
        userIdRef.current = nextUserId;
        return;
      }
      if (userIdRef.current === nextUserId) return;
      userIdRef.current = nextUserId;
      sessionGenerationRef.current += 1;
      readGenerationRef.current += 1;
      mutationRef.current = null;
      setFavorites([]);
      setBusy(false);
      if (!nextUserId) {
        setStatus("error");
        setMessage("로그인 후 즐겨찾기를 다시 불러와 주세요.");
      } else {
        void load();
      }
    }).data.subscription : null;
    return () => {
      mountedRef.current = false;
      window.clearTimeout(task);
      sessionGenerationRef.current += 1;
      readGenerationRef.current += 1;
      mutationRef.current = null;
      subscription?.unsubscribe();
    };
  }, [enabled, load]);

  const beginMutation = useCallback(() => {
    if (mutationRef.current) return null;
    const operation = { id: ++mutationSerialRef.current, session: sessionGenerationRef.current };
    mutationRef.current = operation;
    readGenerationRef.current += 1;
    setBusy(true);
    return operation;
  }, []);

  const operationCurrent = useCallback((operation: { id: number; session: number }) => (
    mountedRef.current && mutationRef.current?.id === operation.id && mutationRef.current.session === operation.session && operation.session === sessionGenerationRef.current
  ), []);

  const finishMutation = useCallback((operation: { id: number; session: number }) => {
    if (mutationRef.current?.id === operation.id && mutationRef.current.session === operation.session) {
      mutationRef.current = null;
      if (operation.session === sessionGenerationRef.current) setBusy(false);
    }
  }, []);

  const add = useCallback(async (place: PlaceSearchResult) => {
    if (!enabled) return false;
    if (favorites.some((favorite) => favorite.place.kakaoPlaceId === place.kakaoPlaceId)) {
      setMessage("이미 저장한 즐겨찾기입니다.");
      return true;
    }
    if (favorites.length >= 3) {
      setMessage("즐겨찾기는 최대 3개까지 저장할 수 있습니다.");
      return false;
    }
    const supabase = getBrowserSupabase();
    const operation = supabase ? beginMutation() : null;
    if (!supabase || !operation) return false;
    try {
      const { data, error } = await supabase.rpc("add_place_favorite", { favorite_place: favoritePlacePayload(place) });
      if (!operationCurrent(operation)) return false;
      if (error) {
        const failure = error.message.includes("FAVORITE_LIMIT") ? "즐겨찾기는 최대 3개까지 저장할 수 있습니다." : "즐겨찾기를 저장하지 못했습니다. 목록을 새로 확인한 뒤 다시 시도해 주세요.";
        const loaded = await load(operation);
        if (operationCurrent(operation)) setMessage(loaded ? failure : `${failure} 최신 목록도 불러오지 못했습니다.`);
        return false;
      }
      const saved = parsePlaceFavorite(Array.isArray(data) ? data[0] : null);
      readGenerationRef.current += 1;
      setFavorites((current) => [...current.filter((favorite) => favorite.slot !== saved.slot && favorite.place.kakaoPlaceId !== saved.place.kakaoPlaceId), saved].sort((a, b) => a.slot - b.slot));
      setStatus("ready");
      setMessage(`${saved.place.name}을(를) 즐겨찾기에 저장했습니다.`);
      return true;
    } catch {
      if (operationCurrent(operation)) {
        const loaded = await load(operation);
        if (operationCurrent(operation)) setMessage(loaded ? "저장 결과를 확인할 수 없어 최신 목록을 다시 확인했습니다." : "저장 결과와 최신 즐겨찾기 목록을 확인할 수 없습니다.");
      }
      return false;
    } finally {
      finishMutation(operation);
    }
  }, [beginMutation, enabled, favorites, finishMutation, load, operationCurrent]);

  const remove = useCallback(async (favorite: PlaceFavorite) => {
    if (!enabled) return false;
    const supabase = getBrowserSupabase();
    const operation = supabase ? beginMutation() : null;
    if (!supabase || !operation) return false;
    try {
      const { error } = await supabase.rpc("remove_place_favorite", { favorite_slot: favorite.slot, expected_place_id: favorite.place.kakaoPlaceId });
      if (!operationCurrent(operation)) return false;
      if (error) {
        const loaded = await load(operation);
        if (operationCurrent(operation)) setMessage(loaded ? "즐겨찾기를 삭제하지 못했습니다. 최신 목록을 확인해 주세요." : "즐겨찾기를 삭제하지 못했고 최신 목록도 불러오지 못했습니다.");
        return false;
      }
      const loaded = await load(operation);
      if (!operationCurrent(operation) || !loaded) return false;
      setMessage(`${favorite.place.name}을(를) 즐겨찾기에서 삭제했습니다.`);
      return true;
    } catch {
      if (operationCurrent(operation)) {
        const loaded = await load(operation);
        if (operationCurrent(operation)) setMessage(loaded ? "삭제 결과를 확인할 수 없어 최신 목록을 다시 확인했습니다." : "삭제 결과와 최신 즐겨찾기 목록을 확인할 수 없습니다.");
      }
      return false;
    } finally {
      finishMutation(operation);
    }
  }, [beginMutation, enabled, finishMutation, load, operationCurrent]);

  const value = useMemo(() => ({ favorites, status, busy, message, retry: () => { if (!mutationRef.current) void load(); }, add, remove }), [add, busy, favorites, load, message, remove, status]);
  return <PlaceFavoritesContext.Provider value={value}>{children}</PlaceFavoritesContext.Provider>;
}

export function usePlaceFavorites() {
  const value = useContext(PlaceFavoritesContext);
  if (!value) throw new Error("PLACE_FAVORITES_PROVIDER_REQUIRED");
  return value;
}
