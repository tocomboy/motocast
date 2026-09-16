"use client";

import { useEffect, useId, useRef, useState } from "react";

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
  placeholder: string;
  required?: boolean;
  autoFocus?: boolean;
  selected: PlaceSearchResult | null;
  onSelect: (place: PlaceSearchResult | null) => void;
  favorites?: PlaceFavoritesControls;
};

export function PlaceSearchField({ label, placeholder, required = false, autoFocus = false, selected, onSelect, favorites }: Props) {
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
  const [managingFavorites, setManagingFavorites] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; searchSequenceRef.current += 1; };
  }, []);

  function openPicker() {
    setQuery(selected?.name ?? "");
    setResults([]);
    setManagingFavorites(false);
    setStatus(selected ? `${selected.name}이(가) 현재 선택되어 있습니다.` : "검색어를 입력해 주세요.");
    dialogRef.current?.showModal();
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }

  function closePicker() {
    searchSequenceRef.current += 1;
    setSearching(false);
    dialogRef.current?.close();
  }

  async function search() {
    const normalized = query.trim().replace(/\s+/g, " ");
    if (normalized.length < 2 || normalized.length > 100) {
      setStatus("장소 이름을 2자 이상 100자 이하로 입력해 주세요.");
      return;
    }
    const supabase = getBrowserSupabase();
    if (!supabase) {
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
        setStatus("장소를 검색하지 못했습니다. 다시 검색해 주세요.");
        return;
      }
      const parsed = parsePlaceSearchResponse(data);
      setResults(parsed.places);
      setStatus(parsed.places.length ? `${parsed.places.length}개 장소를 찾았습니다.` : "검색 결과가 없습니다. 다른 이름이나 주소로 검색해 주세요.");
    } catch {
      if (mountedRef.current && sequence === searchSequenceRef.current) setStatus("장소 검색 응답을 확인할 수 없습니다. 다시 시도해 주세요.");
    } finally {
      if (mountedRef.current && sequence === searchSequenceRef.current) setSearching(false);
    }
  }

  function choose(place: PlaceSearchResult) {
    onSelect(place);
    closePicker();
  }

  return (
    <div className="place-field">
      <span className="place-field-label">{label}{required ? <span className="sr-only"> 필수</span> : null}</span>
      <div className="place-trigger-row">
        <button ref={triggerRef} type="button" className={`place-picker-trigger ${selected ? "is-selected" : ""}`} autoFocus={autoFocus} onClick={openPicker} aria-haspopup="dialog">
          {selected ? <><strong>{selected.name}</strong><span>{selected.roadAddress ?? selected.address}</span></> : <><strong>{placeholder}</strong><span>눌러서 장소 검색</span></>}
        </button>
        {selected ? <button type="button" className="place-clear-button" aria-label={`${selected.name} 선택 해제`} onClick={() => onSelect(null)}>×</button> : null}
      </div>

      <dialog ref={dialogRef} className="place-picker-dialog" aria-labelledby={titleId} onCancel={(event) => { event.stopPropagation(); closePicker(); }} onClose={() => triggerRef.current?.focus()} onKeyDown={(event) => event.stopPropagation()}>
        <div className="place-picker-shell">
          <header className="place-picker-header">
            <button type="button" className="place-picker-back" onClick={closePicker} aria-label={`${label} 검색 닫기`}>←</button>
            <div><p className="eyebrow">PLACE SEARCH</p><h2 id={titleId}>{label} 선택</h2></div>
            <button type="button" className="place-picker-close" onClick={closePicker} aria-label={`${label} 검색 닫기`}>×</button>
          </header>
          <div className="place-picker-search" role="search">
            <label htmlFor={`${titleId}-query`} className="sr-only">{label} 검색어</label>
            <input ref={searchInputRef} id={`${titleId}-query`} value={query} placeholder={placeholder} maxLength={100} onChange={(event) => { searchSequenceRef.current += 1; setSearching(false); setQuery(event.target.value); setResults([]); setStatus("검색 버튼을 눌러 장소를 확인하세요."); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void search(); } }} />
            <button className="primary-button" type="button" disabled={searching} onClick={() => void search()}>{searching ? "검색 중…" : "검색"}</button>
          </div>
          <div className="place-picker-content">
            <aside className="place-favorites" aria-labelledby={`${titleId}-favorites`}>
              <div><h3 id={`${titleId}-favorites`}>공용 즐겨찾기</h3><span>{favorites?.favorites.length ?? 0}/3</span>{favorites ? <button type="button" onClick={() => setManagingFavorites((current) => !current)}>{managingFavorites ? "완료" : "관리"}</button> : null}</div>
              {!favorites ? <p>즐겨찾기 연결 전입니다.</p> : favorites.status === "loading" ? <p role="status">즐겨찾기를 불러오는 중입니다.</p> : favorites.status === "error" ? <div className="place-favorites-error"><p role="alert">{favorites.message}</p><button type="button" onClick={favorites.retry}>다시 시도</button></div> : favorites.favorites.length ? (
                <ul>{favorites.favorites.map((favorite) => <li key={favorite.slot}><button type="button" disabled={managingFavorites} onClick={() => choose(favoriteAsSearchResult(favorite))}><strong>★ {favorite.place.name}</strong><span>{favorite.place.roadAddress ?? favorite.place.address}</span></button>{managingFavorites ? <button type="button" disabled={favorites.busy} aria-label={`${favorite.place.name} 즐겨찾기 삭제`} onClick={() => void favorites.remove(favorite)}>삭제</button> : null}</li>)}</ul>
              ) : <p>검색 결과에서 별을 눌러 최대 3개를 저장하세요.</p>}
              {favorites && favorites.status !== "loading" ? <p className="place-favorite-status" role="status">{favorites.message}</p> : null}
            </aside>
            <section className="place-picker-results" aria-labelledby={`${titleId}-results`}>
              {managingFavorites ? <div className="favorite-manage-intro"><h3>즐겨찾기 관리</h3><p>저장한 장소를 삭제하거나 검색 결과에서 새 장소를 등록할 수 있습니다.</p><button className="primary-button" type="button" onClick={() => { setManagingFavorites(false); searchInputRef.current?.focus(); }}>즐겨찾기 등록</button></div> : <>
              <div><h3 id={`${titleId}-results`}>검색 결과</h3><span>{results.length ? `${results.length}개` : ""}</span></div>
              {results.length ? <ul>{results.map((place) => {
                const saved = favorites?.favorites.some((favorite) => favorite.place.kakaoPlaceId === place.kakaoPlaceId) ?? false;
                return <li key={place.kakaoPlaceId}><div><strong>{place.name}</strong><span>{place.roadAddress ?? place.address}</span>{place.category ? <small>{place.category}</small> : null}</div><div><button type="button" disabled={!favorites || favorites.busy || saved || favorites.favorites.length >= 3} onClick={() => favorites && void favorites.add(place)} aria-label={`${place.name} 즐겨찾기 저장`}>{saved ? "★ 저장됨" : "☆ 저장"}</button><button type="button" className="primary-button" onClick={() => choose(place)}>선택</button></div></li>;
              })}</ul> : <div className="place-picker-empty"><span aria-hidden="true">⌕</span><p>{status}</p>{status.includes("못했습니다") || status.includes("확인할 수 없습니다") ? <button type="button" onClick={() => void search()}>다시 검색</button> : null}</div>}
              {results.length ? <p id={statusId} className="place-status" role="status" aria-live="polite">{status}</p> : null}
              </>}
            </section>
          </div>
        </div>
      </dialog>
    </div>
  );
}
