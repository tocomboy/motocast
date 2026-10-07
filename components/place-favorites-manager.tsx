"use client";

import { LineIcon } from "@/components/line-icon";
import { useEffect, useId, useRef, useState } from "react";

import type { PlaceFavoritesControls } from "@/components/place-search-field";
import type { PlaceFavorite } from "@/lib/places/favorites";
import { parsePlaceSearchResponse, type PlaceSearchResult } from "@/lib/places/search";
import { getBrowserSupabase } from "@/lib/supabase/browser";

import styles from "./place-favorites-manager.module.css";

type PendingFavoriteChange = {
  snapshot: PlaceFavoritesControls;
  snapshotCurrent: () => boolean;
  returnFocus: () => void;
} & ({ action: "add"; place: PlaceSearchResult } | { action: "remove"; favorite: PlaceFavorite });

export function PlaceFavoritesHomeEntry({ onOpen }: { onOpen: () => void }) {
  return <button className={styles.homeEntry} type="button" onClick={onOpen} aria-label="즐겨찾기"><span><strong>즐겨찾기</strong><small>내 장소 1,000개 · 자주 찾는 장소 10개</small></span><LineIcon name="chevron-right" /></button>;
}

export function PlaceFavoritesManager({ favorites, onBack }: { favorites: PlaceFavoritesControls; onBack: () => void }) {
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [pendingChange, setPendingChange] = useState<PendingFavoriteChange | null>(null);

  function requestAdd(place: PlaceSearchResult, returnFocus: () => void) {
    setPendingChange({ action: "add", place, snapshot: favorites, snapshotCurrent: favorites.captureSnapshot(), returnFocus });
  }

  function requestRemove(favorite: PlaceFavorite, button?: HTMLButtonElement) {
    setPendingChange({ action: "remove", favorite, snapshot: favorites, snapshotCurrent: favorites.captureSnapshot(), returnFocus: () => { if (button?.isConnected && !button.disabled) button.focus(); else addButtonRef.current?.focus(); } });
  }

  function canConfirm() {
    if (!pendingChange || pendingChange.snapshot !== favorites || !pendingChange.snapshotCurrent() || favorites.status !== "ready" || favorites.busy) return false;
    return pendingChange.action === "add"
      ? favorites.favorites.length < 3 && !favorites.favorites.some((favorite) => favorite.place.kakaoPlaceId === pendingChange.place.kakaoPlaceId)
      : favorites.favorites.some((favorite) => favorite.slot === pendingChange.favorite.slot && favorite.place.kakaoPlaceId === pendingChange.favorite.place.kakaoPlaceId);
  }

  function closeConfirmation() {
    setPendingChange(null);
    pendingChange?.returnFocus();
  }

  function closeRegistration() {
    setRegistrationOpen(false);
    addButtonRef.current?.focus();
  }

  return (
    <section className={styles.page} aria-labelledby="favorites-view-title">
      <header className={styles.heading}><h1 id="favorites-view-title" data-view-title="favorites" tabIndex={-1}>즐겨찾기</h1><button type="button" onClick={onBack} aria-label="즐겨찾기에서 뒤로">뒤로</button></header>
      <div className={styles.content}>
        <h2>자주 찾는 장소 {favorites.favorites.length} / 3</h2>
        {favorites.status === "loading" ? <p role="status">즐겨찾기를 불러오는 중입니다.</p> : favorites.status === "error" ? (
          <div className={styles.notice}><strong>{favorites.message.includes("결과") ? "변경 결과를 확인하지 못했어요." : "즐겨찾기를 확인하지 못했어요."}</strong><p role="alert">{favorites.message}</p><button type="button" disabled={favorites.busy} onClick={favorites.retry}>목록 다시 확인</button></div>
        ) : favorites.favorites.length ? (
          <ul className={styles.list}>{favorites.favorites.map((favorite) => <li key={favorite.slot}><strong>{favorite.place.name}</strong><span>{favorite.place.roadAddress ?? favorite.place.address}</span><button type="button" disabled={favorites.busy} aria-label={`${favorite.place.name} 즐겨찾기 삭제`} onClick={(event) => requestRemove(favorite, event?.currentTarget)}>삭제</button></li>)}</ul>
        ) : <div className={styles.notice}><strong>저장한 즐겨찾기가 없어요.</strong><p>자주 가는 장소를 추가해 보세요.</p></div>}
        <button ref={addButtonRef} aria-label="+ 즐겨찾기 추가" className={`primary-button ${styles.add}`} type="button" disabled={favorites.status !== "ready" || favorites.busy || favorites.favorites.length >= 3} onClick={() => setRegistrationOpen(true)}><LineIcon name="plus" /> 즐겨찾기 추가</button>
        <p className={styles.helper}>내 장소 1,000개 · 자주 찾는 장소 10개<br />출발·경유·도착에서 함께 사용할 수 있어요.</p>
        {favorites.status === "ready" ? <p className={styles.message} role="status" aria-live="polite">{favorites.message}{favorites.favorites.length >= 3 ? " 새 장소를 추가하려면 기존 장소를 삭제해 주세요." : ""}</p> : null}
      </div>
      {registrationOpen ? <FavoriteRegistrationDialog favorites={favorites} onRequestAdd={requestAdd} onClose={closeRegistration} /> : null}
      {pendingChange ? <FavoriteMutationConfirmation change={pendingChange} valid={canConfirm()} busy={favorites.busy} canConfirm={canConfirm} onConfirm={() => pendingChange.action === "add" ? favorites.add(pendingChange.place) : favorites.remove(pendingChange.favorite)} onClose={closeConfirmation} /> : null}
    </section>
  );
}

function FavoriteRegistrationDialog({ favorites, onRequestAdd, onClose }: { favorites: PlaceFavoritesControls; onRequestAdd: (place: PlaceSearchResult, returnFocus: () => void) => void; onClose: () => void }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(false);
  const sequenceRef = useRef(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlaceSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [settled, setSettled] = useState(false);
  const [status, setStatus] = useState("장소를 검색해 즐겨찾기에 추가하세요.");

  useEffect(() => {
    mountedRef.current = true;
    if (dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
    inputRef.current?.focus();
    return () => { mountedRef.current = false; sequenceRef.current += 1; };
  }, []);

  function close() {
    sequenceRef.current += 1;
    dialogRef.current?.close();
    onClose();
  }

  function clear() {
    sequenceRef.current += 1;
    setQuery("");
    setResults([]);
    setSearching(false);
    setSettled(false);
    setStatus("장소를 검색해 즐겨찾기에 추가하세요.");
    inputRef.current?.focus();
  }

  async function search() {
    const normalized = query.trim().replace(/\s+/g, " ");
    const sequence = ++sequenceRef.current;
    setResults([]);
    setSettled(false);
    if (normalized.length < 2 || normalized.length > 100) {
      setSearching(false);
      setSettled(true);
      setStatus("장소 이름을 2자 이상 100자 이하로 입력해 주세요.");
      return;
    }
    const supabase = getBrowserSupabase();
    if (!supabase) {
      setSettled(true);
      setStatus("장소 검색 연결이 설정되지 않았습니다.");
      return;
    }
    setSearching(true);
    setStatus("카카오 장소를 검색하고 있습니다.");
    try {
      const { data, error } = await supabase.functions.invoke("search-places", { body: { query: normalized, page: 1, size: 10 } });
      if (!mountedRef.current || sequence !== sequenceRef.current) return;
      if (error) throw new Error("PLACE_SEARCH_FAILED");
      const parsed = parsePlaceSearchResponse(data);
      setResults(parsed.places);
      setSettled(true);
      setStatus(parsed.places.length ? `${parsed.places.length}개 장소를 찾았습니다.` : "검색 결과가 없습니다. 다른 이름이나 주소로 검색해 주세요.");
    } catch {
      if (mountedRef.current && sequence === sequenceRef.current) {
        setSettled(true);
        setStatus("장소를 검색하지 못했습니다. 다시 검색해 주세요.");
      }
    } finally {
      if (mountedRef.current && sequence === sequenceRef.current) setSearching(false);
    }
  }

  return (
    <dialog ref={dialogRef} className={`place-picker-dialog ${styles.registration}`} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); event.stopPropagation(); close(); }} onKeyDown={(event) => event.stopPropagation()}>
      <div className="place-picker-shell mode-register">
        <header className="place-picker-header"><div><h2 id={titleId}>즐겨찾기 추가</h2></div><button className="place-picker-close" type="button" onClick={close} aria-label="즐겨찾기 추가 닫기"><LineIcon name="close" /></button></header>
        <div className="place-picker-search" role="search">
          <label className="sr-only" htmlFor={`${titleId}-query`}>즐겨찾기 검색어</label>
          <input ref={inputRef} id={`${titleId}-query`} value={query} maxLength={100} placeholder="장소명 또는 주소 검색" onChange={(event) => { sequenceRef.current += 1; setQuery(event.target.value); setResults([]); setSearching(false); setSettled(false); setStatus("검색 버튼을 눌러 장소를 확인하세요."); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void search(); } }} />
          {query && (searching || settled) ? <button className="place-query-clear" type="button" onClick={clear} aria-label="검색어 지우기"><LineIcon name="close" /></button> : <button className="place-search-button" type="button" disabled={searching} onClick={() => void search()} aria-label={searching ? "장소 검색 중" : "장소 검색"}><LineIcon name="search" /></button>}
        </div>
        <div className="place-picker-content"><section className={`place-picker-results ${styles.registrationResults}`} aria-labelledby={`${titleId}-results`}>
          <h3 id={`${titleId}-results`}>검색 결과</h3>
          <p role="status" aria-live="polite">{status}</p>
          {results.length ? <ul>{results.map((place) => {
            const saved = favorites.favorites.some((favorite) => favorite.place.kakaoPlaceId === place.kakaoPlaceId);
            return <li key={place.kakaoPlaceId}><strong>{place.name}</strong><span>{place.roadAddress ?? place.address}</span><button className="favorite-register-result" type="button" disabled={favorites.status !== "ready" || favorites.busy || saved || favorites.favorites.length >= 3} onClick={() => onRequestAdd(place, () => inputRef.current?.focus())} aria-label={`${place.name} 즐겨찾기 ${saved ? "저장됨" : "추가"}`}>{saved ? "저장됨" : "추가"}</button></li>;
          })}</ul> : status.includes("못했습니다") ? <button type="button" onClick={() => void search()}>다시 검색</button> : null}
          <p className={styles.helper}>이미 저장된 장소·3개 등록 완료·처리 중에는 추가할 수 없어요.</p>
          <p className={styles.message} role={favorites.status === "error" ? "alert" : "status"} aria-live="polite">{favorites.message}</p>
          {favorites.status === "error" ? <button type="button" disabled={favorites.busy} onClick={favorites.retry}>다시 시도</button> : null}
        </section></div>
      </div>
    </dialog>
  );
}

function FavoriteMutationConfirmation({ change, valid, busy, canConfirm, onConfirm, onClose }: { change: PendingFavoriteChange; valid: boolean; busy: boolean; canConfirm: () => boolean; onConfirm: () => Promise<boolean>; onClose: () => void }) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const mountedRef = useRef(false);
  const startedRef = useRef(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const locked = processing && (busy || change.snapshotCurrent());
  const adding = change.action === "add";
  const title = adding ? "즐겨찾기에 추가할까요?" : "즐겨찾기를 삭제할까요?";
  const placeName = adding ? change.place.name : change.favorite.place.name;

  useEffect(() => {
    mountedRef.current = true;
    if (dialogRef.current && !dialogRef.current.open) dialogRef.current.showModal();
    return () => { mountedRef.current = false; };
  }, []);

  function dismiss() {
    dialogRef.current?.close();
    onClose();
  }

  function cancel() {
    if (!locked) dismiss();
  }

  async function confirm() {
    if (startedRef.current || !canConfirm()) return;
    startedRef.current = true;
    setProcessing(true);
    try {
      await onConfirm();
      if (mountedRef.current) dismiss();
    } catch {
      if (mountedRef.current) setError("변경 결과를 확인할 수 없습니다. 팝업을 닫고 목록을 다시 확인해 주세요.");
    } finally {
      if (mountedRef.current) setProcessing(false);
    }
  }

  return <dialog ref={dialogRef} className={styles.confirmation} aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={(event) => { event.preventDefault(); event.stopPropagation(); cancel(); }} onKeyDown={(event) => event.stopPropagation()}>
    <header><h2 id={titleId}>{title}</h2><button type="button" disabled={locked} onClick={cancel} aria-label={`즐겨찾기 ${adding ? "추가" : "삭제"} 확인 닫기`}><LineIcon name="close" /></button></header>
    <strong>{valid || locked ? placeName : "선택한 장소를 다시 확인해 주세요."}</strong>
    <p id={descriptionId}>{adding ? "자주 가는 장소로 저장합니다." : "즐겨찾기 목록에서만 삭제합니다."}</p>
    {!valid && !locked ? <p role="alert">목록이나 계정이 바뀌었어요. 팝업을 닫고 최신 목록에서 다시 선택해 주세요.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {locked ? <p role="status">변경 결과를 확인하고 있습니다.</p> : null}
    <div className={styles.confirmationActions}><button type="button" disabled={locked} onClick={cancel}>취소</button><button className={adding ? "primary-button" : "destructive-button"} type="button" disabled={!valid || processing || !!error} onClick={() => void confirm()}>{adding ? "추가" : "삭제"}</button></div>
  </dialog>;
}
