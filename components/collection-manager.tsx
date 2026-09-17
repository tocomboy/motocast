"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { parseCollectionRows, type CollectionCourse, type RidingCollection } from "@/lib/collections/contracts";
import { getBrowserSupabase } from "@/lib/supabase/browser";

type CollectionManagerProps = {
  currentCourse: CollectionCourse | null;
  onApply: (course: CollectionCourse, title: string) => void;
  onShare: (course: CollectionCourse, title: string) => void;
  disabled?: boolean;
  mode?: "manage" | "home" | "save" | "save-panel";
  onShowCollections?: () => void;
  onCancel?: () => void;
  onSaved?: (title: string) => void;
  onBusyChange?: (busy: boolean) => void;
  triggerLabel?: string;
};

export function CollectionManager({ currentCourse, onApply, onShare, disabled = false, mode = "manage", onShowCollections, onCancel, onSaved, onBusyChange, triggerLabel = "경로 저장" }: CollectionManagerProps) {
  const [collections, setCollections] = useState<RidingCollection[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState(mode === "save" || mode === "save-panel" ? "경로 이름을 입력해 주세요." : "컬렉션을 불러오는 중입니다.");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [savedTitle, setSavedTitle] = useState("");
  const [operationFeedback, setOperationFeedback] = useState("");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const saveAttemptRef = useRef<{ payloadKey: string; operationId: string } | null>(null);
  const savePendingRef = useRef(false);
  const mountedRef = useRef(true);
  const saveDialogRef = useRef<HTMLDialogElement>(null);
  const saveTriggerRef = useRef<HTMLButtonElement>(null);
  const saveTitleId = useId();

  const loadCollections = useCallback(async (preserveStatus = false) => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setLoadState("loading");
    const { data, error } = await supabase
      .from("riding_collections")
      .select("id,title,description,updated_at,collection_versions(id,version_number,origin,destination,points,created_at)")
      .order("updated_at", { ascending: false });
    if (error) {
      setLoadState("error");
      setStatus("컬렉션을 불러오지 못했습니다. 이용 권한과 연결 상태를 확인해 주세요.");
      return;
    }
    try {
      const parsed = parseCollectionRows(data);
      setCollections(parsed);
      setLoadState("ready");
      if (!preserveStatus) setStatus(parsed.length ? `${parsed.length}개의 내 컬렉션을 불러왔습니다.` : "저장된 컬렉션이 없습니다.");
    } catch {
      setLoadState("error");
      setStatus("저장된 컬렉션 응답을 안전하게 확인하지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (mode === "save" || mode === "save-panel") return () => { mountedRef.current = false; };
    const task = window.setTimeout(() => void loadCollections(), 0);
    return () => { mountedRef.current = false; window.clearTimeout(task); };
  }, [loadCollections, mode]);

  useEffect(() => {
    if (mode === "save-panel") onBusyChange?.(busyId !== null);
    return () => { if (mode === "save-panel") onBusyChange?.(false); };
  }, [busyId, mode, onBusyChange]);

  async function saveVersion(collection: RidingCollection | null) {
    if (disabled || savePendingRef.current) return;
    const collectionTitle = collection?.title ?? title.trim();
    const collectionDescription = collection?.description ?? description;
    if (!collectionTitle || !currentCourse) {
      setStatus("컬렉션 이름과 선택된 출발지·복귀지가 필요합니다.");
      return;
    }
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const payload = {
      collectionId: collection?.id ?? null,
      title: collectionTitle,
      description: collectionDescription,
      origin: currentCourse.origin,
      destination: currentCourse.destination,
      points: currentCourse.points,
    };
    const payloadKey = JSON.stringify(payload);
    if (!saveAttemptRef.current || saveAttemptRef.current.payloadKey !== payloadKey) {
      saveAttemptRef.current = { payloadKey, operationId: crypto.randomUUID() };
    }
    const targetId = collection?.id ?? "new";
    savePendingRef.current = true;
    setBusyId(targetId);
    let data: unknown;
    let error: unknown;
    try {
      ({ data, error } = await supabase.functions.invoke("save-collection", { body: { saveOperationId: saveAttemptRef.current.operationId, ...payload } }));
    } catch {
      error = true;
    }
    if (!mountedRef.current) return;
    if (error || !data || typeof data !== "object" || !Number.isInteger((data as { versionNumber?: unknown }).versionNumber)) {
      savePendingRef.current = false;
      setBusyId(null);
      const message = "컬렉션을 저장하지 못했습니다. 입력과 이용 권한을 확인해 주세요.";
      if (collection) setOperationFeedback(message);
      else setStatus(message);
      return;
    }
    setTitle("");
    setDescription("");
    setSavedTitle(collectionTitle);
    saveAttemptRef.current = null;
    const successMessage = `${collectionTitle} 컬렉션의 ${(data as { versionNumber: number }).versionNumber}번째 불변 버전을 저장했습니다.`;
    if (collection) setOperationFeedback(successMessage);
    else setStatus(successMessage);
    if (!collection && mode === "save-panel") {
      onSaved?.(collectionTitle);
      savePendingRef.current = false;
      setBusyId(null);
      return;
    }
    savePendingRef.current = false;
    setBusyId(null);
    await loadCollections(true);
  }

  async function deleteCollection(collection: RidingCollection) {
    if (disabled) return;
    if (!window.confirm(`${collection.title} 컬렉션과 모든 버전을 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setBusyId(collection.id);
    const { error } = await supabase.rpc("delete_riding_collection", {
      target_collection_id: collection.id,
    });
    setBusyId(null);
    if (error) {
      setOperationFeedback("컬렉션을 삭제하지 못했습니다. 이미 삭제됐거나 이용 권한이 없습니다.");
      return;
    }
    setOperationFeedback(`${collection.title} 컬렉션을 삭제했습니다.`);
    await loadCollections();
  }

  const collectionItems = collections.map((collection) => (
    <li key={collection.id} data-collection-id={collection.id}>
      <div>
        <strong>{collection.title}</strong>
        <span>{collection.latestVersion.course.origin.name} → {collection.latestVersion.course.points.map((point) => point.name).join(" → ")}{collection.latestVersion.course.points.length ? " → " : ""}{collection.latestVersion.course.destination.name}</span>
        <small>방문 순서와 휴식 시간을 함께 저장해요. · 휴식 {collection.latestVersion.course.points.filter((point) => point.dwellMinutes > 0).reduce((sum, point) => sum + point.dwellMinutes, 0)}분</small>
        {collection.description ? <small>{collection.description}</small> : null}
      </div>
      <div className="collection-actions">
        <button className="primary-button" type="button" aria-label={`${collection.title} 계획에 적용`} disabled={disabled} onClick={() => onApply(collection.latestVersion.course, collection.title)}>이 경로로 출발하기</button>
        {mode === "manage" ? <details className="collection-card-management"><summary aria-label={`${collection.title} 경로명 관리`}>⋯</summary><div><button type="button" aria-label={`${collection.title} 공유 준비`} disabled={disabled} onClick={() => onShare(collection.latestVersion.course, collection.title)}>공유 준비</button><button type="button" aria-label={`${collection.title} 새 버전 저장`} disabled={disabled || busyId !== null || !currentCourse} onClick={() => void saveVersion(collection)}>현재 경로로 새 버전 저장</button><button className="danger-text" type="button" aria-label={`${collection.title} 삭제`} disabled={disabled || busyId !== null} onClick={() => void deleteCollection(collection)}>삭제</button></div></details> : null}
      </div>
    </li>
  ));

  const courseOrder = currentCourse ? [currentCourse.origin.name, ...currentCourse.points.map((point) => point.name), currentCourse.destination.name].join(" → ") : "저장할 경로가 없습니다.";
  const saveFields = <>
    <p className="collection-save-route">{courseOrder}</p>
    <p className="collection-save-scope">출발 날짜·시간과 날씨는 저장하지 않습니다.</p>
    <label><span>경로 이름</span><input disabled={busyId !== null} maxLength={120} value={title} onChange={(event) => { setTitle(event.target.value); setSavedTitle(""); }} placeholder="예: 북한강 아침 코스" /></label>
    <details className="collection-description-field"><summary>설명 추가</summary><label><span className="sr-only">경로 설명</span><textarea disabled={busyId !== null} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="도로 특징이나 주의점을 기록하세요." /></label></details>
    <p className="manager-status" role={status.includes("못했습니다") || status.includes("필요합니다") ? "alert" : "status"} aria-live="polite">{status}</p>
  </>;

  if (mode === "home") return <section className="collection-manager collection-manager-home" aria-label="최근 저장한 경로">{loadState === "loading" ? <p className="collection-loading" role="status">저장한 경로를 불러오는 중입니다.</p> : loadState === "error" ? <div className="collection-load-error" role="alert"><p>{status}</p><button type="button" onClick={() => void loadCollections()}>다시 시도</button></div> : collections.length ? <ul className="collection-list">{collectionItems.slice(0, 1)}</ul> : null}{loadState === "ready" ? <p className="manager-status sr-only" role="status" aria-live="polite">{status}</p> : null}</section>;

  if (mode === "save-panel") return <section className="collection-manager collection-manager-save-panel" aria-label="내 경로에 저장">{saveFields}<div className="collection-save-actions"><button type="button" disabled={busyId !== null} onClick={onCancel}>취소</button><button className="primary-button" type="button" disabled={disabled || busyId !== null || !currentCourse || !title.trim()} onClick={() => void saveVersion(null)}>{busyId === "new" ? "저장 중…" : "내 경로에 저장"}</button></div></section>;

  if (mode === "save") return <section className="collection-manager collection-manager-save" aria-label="경로 저장">
    <button ref={saveTriggerRef} className="secondary-button" type="button" disabled={disabled || !currentCourse} onClick={() => saveDialogRef.current?.showModal()}>{triggerLabel}</button>
    <dialog ref={saveDialogRef} className="collection-save-dialog" aria-labelledby={saveTitleId} onClose={() => saveTriggerRef.current?.focus()} onCancel={(event) => { if (busyId !== null) event.preventDefault(); }}>
      <div className="collection-save-shell"><header><h2 id={saveTitleId}>내 경로에 저장</h2><button type="button" disabled={busyId !== null} onClick={() => saveDialogRef.current?.close()} aria-label="경로 저장 창 닫기">×</button></header>{savedTitle ? <div className="collection-save-success" role="status"><strong>{savedTitle}</strong><span>내 경로에 저장했습니다. 새 일정을 정해 다시 사용할 수 있어요.</span></div> : saveFields}<div className="collection-save-actions">{savedTitle && onShowCollections ? <button type="button" onClick={() => { saveDialogRef.current?.close(); onShowCollections(); }}>저장한 경로 보기</button> : null}<button type="button" disabled={busyId !== null} onClick={() => saveDialogRef.current?.close()}>{savedTitle ? "닫기" : "취소"}</button>{!savedTitle ? <button className="primary-button" type="button" disabled={disabled || busyId !== null || !currentCourse || !title.trim()} onClick={() => void saveVersion(null)}>{busyId === "new" ? "저장 중…" : "저장"}</button> : null}</div></div>
    </dialog>
  </section>;

  return (
    <section className="collection-manager" aria-labelledby="collection-heading">
      <div className="collection-heading-row">
        <div>
          <h2 id="collection-heading">내가 저장한 경로 {collections.length}</h2>
          <p>마음에 드는 경로를 모아두고<br />다음 라이딩에 다시 꺼내 쓰세요.</p>
        </div>
        <button className="text-button" type="button" disabled={disabled} onClick={() => void loadCollections()}>새로고침</button>
      </div>

      {loadState === "loading" ? <p className="collection-loading" role="status">저장한 경로를 불러오는 중입니다.</p> : loadState === "error" ? <div className="collection-load-error" role="alert"><h3>저장한 경로를 불러오지 못했습니다</h3><p>{status}</p><button type="button" onClick={() => void loadCollections()}>다시 시도</button></div> : collections.length ? (
        <ul className="collection-list">{collectionItems}</ul>
      ) : <div className="collection-empty"><h3>아직 저장한 경로가 없어요</h3><p>라이딩 결과에서 마음에 드는 경로를 저장해 보세요.</p></div>}
      {operationFeedback ? <p className="manager-operation-feedback" role={operationFeedback.includes("못했습니다") ? "alert" : "status"} aria-live="polite">{operationFeedback}</p> : null}
      <aside className="collection-schedule-note"><strong className="mobile-collection-note">출발 날짜·시간은 새로 정해요</strong><span className="mobile-collection-note">저장한 경로를 선택하면 날짜·시간 선택 화면으로 바로 이동합니다.</span><span className="desktop-collection-note">저장 항목: 출발지 · 경유지 순서 · 휴식 시간 · 도착지<br />출발 날짜·시간은 저장하지 않으며, 출발할 때마다 새로 설정해요.</span></aside>
      {loadState === "ready" ? <p className="manager-status sr-only" role="status" aria-live="polite">{status}</p> : null}
    </section>
  );
}
