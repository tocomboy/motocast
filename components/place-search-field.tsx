"use client";

import { LineIcon, StarMark } from "@/components/line-icon";
import { useEffect, useId, useRef, useState } from "react";

import { favoriteAsSearchResult, type PlaceFavorite } from "@/lib/places/favorites";
import { FREQUENT_PLACE_LIMIT } from "@/lib/places/saved";
import { parsePlaceSearchResponse, type PlaceSearchResult } from "@/lib/places/search";
import { getBrowserSupabase } from "@/lib/supabase/browser";

export type PlaceFavoritesControls = {
  favorites: PlaceFavorite[];
  status: "loading" | "ready" | "error";
  busy: boolean;
  message: string;
  retry: () => void;
  add: (place: PlaceSearchResult) => Promise<boolean>;
  remove: (favorite: PlaceFavorite) => Promise<boolean>;
  captureSnapshot: () => () => boolean;
};

type Props = {
  label: string;
  accessibleLabel?: string;
  placeholder: string;
  required?: boolean;
  autoFocus?: boolean;
  selected: PlaceSearchResult | null;
  onSelect: (place: PlaceSearchResult | null) => void;
  onActivate?: () => void;
  /** Each time the picker opens (not on focus): e.g. re-read stars changed on another device. */
  onOpen?: () => void;
  favorites?: Pick<PlaceFavoritesControls, "favorites" | "status" | "message" | "retry">;
  presentation?: "default" | "waypoint";
  selectionActionLabel?: string;
  /** SRC01 "저장 장소 전체 보기": opens the favorites places screen. */
  onOpenSavedPlaces?: () => void;
};

export function PlaceSearchField({ label, accessibleLabel, placeholder, required = false, autoFocus = false, selected, onSelect, onActivate, favorites, presentation = "default", selectionActionLabel, onOpenSavedPlaces, onOpen }: Props) {
  const titleId = useId();
  const statusId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchSequenceRef = useRef(0);
  const mountedRef = useRef(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [status, setStatus] = useState("검색어를 입력해 주세요.");
  const [searching, setSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchSettled, setSearchSettled] = useState(false);
  const roleLabel = accessibleLabel ?? label;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; searchSequenceRef.current += 1; };
  }, []);

  function openPicker() {
    onActivate?.();
    onOpen?.();
    setQuery(selected?.name ?? "");
    setResults([]);
    setShowResults(false);
    setSearchSettled(false);
    setStatus(selected ? `${selected.name}이(가) 현재 선택되어 있습니다.` : "검색어를 입력해 주세요.");
    dialogRef.current?.showModal();
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }

  function invalidateSearch() {
    searchSequenceRef.current += 1;
    setSearching(false);
  }

  function closePicker() {
    invalidateSearch();
    dialogRef.current?.close();
  }

  function back() {
    invalidateSearch();
    if (showResults) {
      setQuery("");
      setResults([]);
      setShowResults(false);
      setSearchSettled(false);
      setStatus("검색어를 입력해 주세요.");
      window.setTimeout(() => searchInputRef.current?.focus(), 0);
      return;
    }
    closePicker();
  }

  async function search() {
    const normalized = query.trim().replace(/\s+/g, " ");
    setShowResults(true);
    if (normalized.length < 2 || normalized.length > 100) {
      setSearchSettled(true);
      setStatus("장소 이름을 2자 이상 100자 이하로 입력해 주세요.");
      return;
    }
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setSearchSettled(true);
      setStatus("장소 검색 연결이 설정되지 않았습니다.");
      return;
    }
    const sequence = ++searchSequenceRef.current;
    setSearching(true);
    setResults([]);
    setStatus("카카오 장소를 검색하고 있습니다.");
    try {
      const { data, error } = await supabase.functions.invoke("search-places", { body: { query: normalized, page: 1, size: 10 } });
      if (!mountedRef.current || sequence !== searchSequenceRef.current) return;
      if (error) {
        setSearchSettled(true);
        setStatus("장소를 검색하지 못했습니다. 다시 검색해 주세요.");
        return;
      }
      const parsed = parsePlaceSearchResponse(data);
      setResults(parsed.places);
      setSearchSettled(true);
      setStatus(parsed.places.length ? `${parsed.places.length}개 장소를 찾았습니다.` : "검색 결과가 없습니다. 다른 이름이나 주소로 검색해 주세요.");
    } catch {
      if (mountedRef.current && sequence === searchSequenceRef.current) {
        setSearchSettled(true);
        setStatus("장소 검색 응답을 확인할 수 없습니다. 다시 시도해 주세요.");
      }
    } finally {
      if (mountedRef.current && sequence === searchSequenceRef.current) setSearching(false);
    }
  }

  function choose(place: PlaceSearchResult) {
    onSelect(place);
    closePicker();
  }

  const choiceLabel = selectionActionLabel ?? (roleLabel.includes("출발") ? "출발지로 선택" : roleLabel.includes("도착") || roleLabel.includes("복귀") ? "도착지로 선택" : "경유지로 선택");

  return (
    <div className={`place-field ${presentation === "waypoint" ? "is-waypoint-presentation" : ""}`}>
      <span className={`place-field-label ${presentation === "waypoint" ? "sr-only" : ""}`}>{label}{required ? <span className="sr-only"> 필수</span> : null}</span>
      <div className="place-trigger-row">
        <button
          ref={triggerRef}
          type="button"
          className={`place-picker-trigger ${selected ? "is-selected" : ""}`}
          autoFocus={autoFocus}
          onFocus={onActivate}
          onClick={openPicker}
          aria-haspopup="dialog"
          aria-label={`${roleLabel}, ${selected?.name ?? placeholder}`}
        >
          {selected ? <><strong>{selected.name}</strong><span>{selected.roadAddress ?? selected.address}</span></> : <><strong>{placeholder}</strong><span>눌러서 장소 검색</span></>}
        </button>
      </div>

      <dialog ref={dialogRef} className="place-picker-dialog" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); event.stopPropagation(); back(); }} onClose={() => triggerRef.current?.focus()} onKeyDown={(event) => event.stopPropagation()}>
        <div className={`place-picker-shell mode-search selection-only ${showResults ? "show-results" : "show-favorites"}`}>
          <header className="place-picker-header">
            <button type="button" className="place-picker-back" onClick={back} aria-label={showResults ? `${roleLabel} 선택으로 돌아가기` : `${roleLabel} 선택에서 뒤로`}><LineIcon name="chevron-left" /></button>
            <div><h2 id={titleId}>{roleLabel} 선택</h2></div>
            <button type="button" className="place-picker-close" onClick={closePicker} aria-label={`${roleLabel} 검색 닫기`}><LineIcon name="close" /></button>
          </header>
          <div className="place-picker-search" role="search">
            <label htmlFor={`${titleId}-query`} className="sr-only">{roleLabel} 검색어</label>
            <input ref={searchInputRef} id={`${titleId}-query`} value={query} placeholder="장소명 또는 주소 검색" maxLength={100} onChange={(event) => { searchSequenceRef.current += 1; setSearching(false); setSearchSettled(false); setShowResults(true); setQuery(event.target.value); setResults([]); setStatus("검색 버튼을 눌러 장소를 확인하세요."); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void search(); } }} />
            {query && (searching || searchSettled) ? <button className="place-query-clear" type="button" onClick={() => { invalidateSearch(); setQuery(""); setResults([]); setShowResults(false); setSearchSettled(false); setStatus("검색어를 입력해 주세요."); searchInputRef.current?.focus(); }} aria-label="검색어 지우기"><LineIcon name="close" /></button> : <button className="place-search-button" type="button" disabled={searching} onClick={() => void search()} aria-label={searching ? "장소 검색 중" : "장소 검색"}><LineIcon name="search" /></button>}
          </div>
          <div className="place-picker-content">
            <aside className="place-favorites" aria-labelledby={`${titleId}-favorites`}>
              <div className="place-favorites-heading"><h3 id={`${titleId}-favorites`}>자주 찾는 장소</h3><span>{favorites?.favorites.length ?? 0} / {FREQUENT_PLACE_LIMIT}</span></div>
              {!favorites ? <p>즐겨찾기 연결 전입니다.</p> : favorites.status === "loading" ? <p role="status">즐겨찾기를 불러오는 중입니다.</p> : favorites.status === "error" ? <div className="place-favorites-error"><p role="alert">{favorites.message}</p><button type="button" onClick={favorites.retry}>다시 시도</button></div> : favorites.favorites.length ? (
                <ul>{favorites.favorites.map((favorite) => <li key={favorite.slot}><button type="button" onClick={() => choose(favoriteAsSearchResult(favorite))}><strong><StarMark filled size={20} /> {favorite.displayName ?? favorite.place.name}</strong>{favorite.sourceLabel ? <small className="place-favorite-source">{favorite.sourceLabel}</small> : null}<span>{favorite.place.roadAddress ?? favorite.place.address}</span></button></li>)}</ul>
              ) : <p>자주 찾는 장소가 없어요. 홈의 즐겨찾기에서 추가할 수 있어요.</p>}
              {favorites && favorites.status !== "loading" && favorites.status !== "error" ? <p className="place-favorite-status" role="status">{favorites.message}</p> : null}
              {onOpenSavedPlaces ? <button type="button" className="place-saved-all" onClick={() => { closePicker(); onOpenSavedPlaces(); }}>저장 장소 전체 보기<LineIcon name="chevron-right" /></button> : null}
            </aside>
            <section className="place-picker-results" aria-labelledby={`${titleId}-results`}>
              <div><h3 id={`${titleId}-results`}>검색 결과</h3><span>{results.length ? `${results.length}개` : ""}</span></div>
              {results.length ? <ul>{results.map((place) => <li key={place.kakaoPlaceId}><div><strong>{place.name}</strong><span>{place.roadAddress ?? place.address}</span>{place.category ? <small>{place.category}</small> : null}</div><div><button type="button" className="primary-button place-result-select" onClick={() => choose(place)}>{choiceLabel}</button></div></li>)}</ul> : <div className="place-picker-empty"><span aria-hidden="true"><LineIcon name="search" /></span><p>{status}</p>{status.includes("못했습니다") || status.includes("확인할 수 없습니다") ? <button type="button" onClick={() => void search()}>다시 검색</button> : null}</div>}
              {results.length ? <p id={statusId} className="place-status" role="status" aria-live="polite">{status}</p> : null}
            </section>
          </div>
          {selected ? <div className="current-place-clear-row"><button type="button" className="current-place-clear" onClick={() => { onSelect(null); closePicker(); }}>현재 장소 선택 해제</button></div> : null}
        </div>
      </dialog>
    </div>
  );
}
