"use client";

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";

import { favoriteAsSearchResult, type PlaceFavorite } from "@/lib/places/favorites";
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
  favorites?: PlaceFavoritesControls;
  presentation?: "default" | "waypoint";
};

export function PlaceSearchField({ label, accessibleLabel, placeholder, required = false, autoFocus = false, selected, onSelect, onActivate, favorites, presentation = "default" }: Props) {
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
  const [pickerMode, setPickerMode] = useState<"search" | "manage" | "register">("search");
  const roleLabel = accessibleLabel ?? label;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; searchSequenceRef.current += 1; };
  }, []);

  function openPicker() {
    onActivate?.();
    setQuery(selected?.name ?? "");
    setResults([]);
    setShowResults(false);
    setSearchSettled(false);
    setPickerMode("search");
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
    if (pickerMode === "register") {
      setPickerMode("manage");
      setShowResults(false);
      setResults([]);
      setStatus("즐겨찾기를 관리하거나 새 장소를 등록할 수 있습니다.");
      return;
    }
    if (pickerMode === "manage") {
      setPickerMode("search");
      setShowResults(false);
      setStatus("검색어를 입력해 주세요.");
      window.setTimeout(() => searchInputRef.current?.focus(), 0);
      return;
    }
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

  const choiceLabel = roleLabel.includes("출발") ? "출발지로 선택" : roleLabel.includes("도착") || roleLabel.includes("복귀") ? "도착지로 선택" : "경유지로 선택";

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
        <div className={`place-picker-shell mode-${pickerMode} ${showResults ? "show-results" : "show-favorites"}`}>
          <header className="place-picker-header">
            <button type="button" className="place-picker-back" onClick={back} aria-label={pickerMode === "register" ? "즐겨찾기 관리로 돌아가기" : pickerMode === "manage" || showResults ? `${roleLabel} 선택으로 돌아가기` : `${roleLabel} 검색 닫기`}>←</button>
            <div><h2 id={titleId}>{pickerMode === "manage" ? "즐겨찾기 관리" : pickerMode === "register" ? "즐겨찾기 등록" : showResults ? "장소 검색" : `${roleLabel} 선택`}</h2></div>
            <button type="button" className="place-picker-close" onClick={closePicker} aria-label={`${roleLabel} 검색 닫기`}>×</button>
          </header>
          <div className="place-picker-search" role="search">
            <label htmlFor={`${titleId}-query`} className="sr-only">{roleLabel} 검색어</label>
            <input ref={searchInputRef} id={`${titleId}-query`} value={query} placeholder="장소명 또는 주소 검색" maxLength={100} onChange={(event) => { searchSequenceRef.current += 1; setSearching(false); setSearchSettled(false); setShowResults(true); setQuery(event.target.value); setResults([]); setStatus("검색 버튼을 눌러 장소를 확인하세요."); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void search(); } }} />
            {query && (searching || searchSettled) ? <button className="place-query-clear" type="button" onClick={() => { invalidateSearch(); setQuery(""); setResults([]); setShowResults(false); setSearchSettled(false); setStatus("검색어를 입력해 주세요."); searchInputRef.current?.focus(); }} aria-label="검색어 지우기">×</button> : <button className="place-search-button" type="button" disabled={searching} onClick={() => void search()} aria-label={searching ? "장소 검색 중" : "장소 검색"}><Image src="/figma/search.svg" alt="" width={20} height={20} /></button>}
          </div>
          <div className="place-picker-content">
            <aside className="place-favorites" aria-labelledby={`${titleId}-favorites`}>
              <div className="place-favorites-heading"><h3 id={`${titleId}-favorites`}>{pickerMode === "manage" ? <>공용 즐겨찾기 <span>{favorites?.favorites.length ?? 0} / 3</span></> : "공용 즐겨찾기"}</h3>{pickerMode !== "manage" ? <span>{favorites?.favorites.length ?? 0}/3</span> : null}{favorites && pickerMode === "search" ? <button type="button" onClick={() => { invalidateSearch(); setPickerMode("manage"); }}>관리</button> : null}</div>
              {!favorites ? <p>즐겨찾기 연결 전입니다.</p> : favorites.status === "loading" ? <p role="status">즐겨찾기를 불러오는 중입니다.</p> : favorites.status === "error" ? <div className="place-favorites-error"><p role="alert">{favorites.message}</p><button type="button" onClick={favorites.retry}>다시 시도</button></div> : favorites.favorites.length ? (
                <ul>{favorites.favorites.map((favorite) => <li key={favorite.slot}><button type="button" disabled={pickerMode !== "search"} onClick={() => { if (pickerMode === "search") choose(favoriteAsSearchResult(favorite)); }}><strong>{pickerMode === "search" ? "★ " : ""}{favorite.place.name}</strong><span>{favorite.place.roadAddress ?? favorite.place.address}</span></button>{pickerMode === "manage" ? <button type="button" disabled={favorites.busy} aria-label={`${favorite.place.name} 즐겨찾기 삭제`} onClick={() => void favorites.remove(favorite)}>삭제</button> : null}</li>)}</ul>
              ) : <p>검색 결과에서 별을 눌러 최대 3개를 저장하세요.</p>}
              {favorites && favorites.status !== "loading" && favorites.status !== "error" && pickerMode !== "manage" ? <p className="place-favorite-status" role="status">{favorites.message}</p> : null}
              {pickerMode === "manage" ? <div className="favorite-manage-controls"><button className="primary-button favorite-register-button" type="button" onClick={() => { invalidateSearch(); setQuery(""); setResults([]); setShowResults(false); setSearchSettled(false); setPickerMode("register"); window.setTimeout(() => searchInputRef.current?.focus(), 0); }}><span aria-hidden="true">+ </span>즐겨찾기 등록</button><p className="favorite-manage-helper" role="status">{favorites?.message || "즐겨찾기는 최대 3개까지 등록할 수 있어요."}</p></div> : null}
            </aside>
            {pickerMode !== "manage" ? <section className="place-picker-results" aria-labelledby={`${titleId}-results`}>
              <div><h3 id={`${titleId}-results`}>검색 결과</h3><span>{results.length ? `${results.length}개` : ""}</span></div>
              {results.length ? <ul>{results.map((place) => {
                const saved = favorites?.favorites.some((favorite) => favorite.place.kakaoPlaceId === place.kakaoPlaceId) ?? false;
                return <li key={place.kakaoPlaceId}><div><strong>{place.name}</strong><span>{place.roadAddress ?? place.address}</span>{place.category ? <small>{place.category}</small> : null}</div><div>{pickerMode === "register" ? <button className="favorite-register-result" type="button" disabled={!favorites || favorites.busy || saved || favorites.favorites.length >= 3} onClick={() => favorites && void favorites.add(place)} aria-label={`${place.name} 즐겨찾기 저장`}>{saved ? "저장됨" : "등록"}</button> : <button type="button" className="primary-button place-result-select" onClick={() => choose(place)}>{choiceLabel}</button>}</div></li>;
              })}</ul> : <div className="place-picker-empty"><span aria-hidden="true">⌕</span><p>{status}</p>{status.includes("못했습니다") || status.includes("확인할 수 없습니다") ? <button type="button" onClick={() => void search()}>다시 검색</button> : null}</div>}
              {results.length ? <p id={statusId} className="place-status" role="status" aria-live="polite">{status}</p> : null}
            </section> : null}
          </div>
          {pickerMode === "manage" ? <footer className="favorite-manage-footer"><button className="favorite-manage-done" type="button" onClick={back}>완료</button></footer> : null}
          {pickerMode === "search" && selected ? <div className="current-place-clear-row"><button type="button" className="current-place-clear" onClick={() => { onSelect(null); closePicker(); }}>현재 장소 선택 해제</button></div> : null}
        </div>
      </dialog>
    </div>
  );
}
