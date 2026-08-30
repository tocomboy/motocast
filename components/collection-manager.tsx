"use client";

import { useCallback, useEffect, useState } from "react";

import { parseCollectionRows, type CollectionPoint, type RidingCollection } from "@/lib/collections/contracts";
import { getBrowserSupabase } from "@/lib/supabase/browser";

type CollectionManagerProps = {
  currentPoints: CollectionPoint[];
  onApply: (points: CollectionPoint[], title: string) => void;
};

export function CollectionManager({ currentPoints, onApply }: CollectionManagerProps) {
  const [collections, setCollections] = useState<RidingCollection[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("컬렉션을 불러오는 중입니다.");
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadCollections = useCallback(async () => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const { data, error } = await supabase
      .from("riding_collections")
      .select("id,title,description,updated_at,collection_versions(id,version_number,points,created_at)")
      .order("updated_at", { ascending: false });
    if (error) {
      setStatus("컬렉션을 불러오지 못했습니다. 이용 권한과 연결 상태를 확인해 주세요.");
      return;
    }
    try {
      const parsed = parseCollectionRows(data);
      setCollections(parsed);
      setStatus(parsed.length ? `${parsed.length}개의 내 컬렉션을 불러왔습니다.` : "저장된 컬렉션이 없습니다.");
    } catch {
      setStatus("저장된 컬렉션 응답을 안전하게 확인하지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => void loadCollections(), 0);
    return () => window.clearTimeout(task);
  }, [loadCollections]);

  async function saveVersion(collection: RidingCollection | null) {
    const collectionTitle = collection?.title ?? title.trim();
    const collectionDescription = collection?.description ?? description;
    if (!collectionTitle || currentPoints.length === 0) {
      setStatus("컬렉션 이름과 현재 계획의 경유지가 필요합니다.");
      return;
    }
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    const targetId = collection?.id ?? "new";
    setBusyId(targetId);
    const { data, error } = await supabase.rpc("save_collection_version", {
      target_collection_id: collection?.id ?? null,
      collection_title: collectionTitle,
      collection_description: collectionDescription,
      collection_points: currentPoints,
    });
    setBusyId(null);
    if (error || !Array.isArray(data) || data.length !== 1 || !Number.isInteger(data[0]?.version_number)) {
      setStatus("컬렉션을 저장하지 못했습니다. 입력과 이용 권한을 확인해 주세요.");
      return;
    }
    setTitle("");
    setDescription("");
    setStatus(`${collectionTitle} 컬렉션의 ${data[0].version_number}번째 불변 버전을 저장했습니다.`);
    await loadCollections();
  }

  async function deleteCollection(collection: RidingCollection) {
    if (!window.confirm(`${collection.title} 컬렉션과 모든 버전을 삭제할까요? 이 작업은 되돌릴 수 없습니다.`)) return;
    const supabase = getBrowserSupabase();
    if (!supabase) return;
    setBusyId(collection.id);
    const { error } = await supabase.rpc("delete_riding_collection", {
      target_collection_id: collection.id,
    });
    setBusyId(null);
    if (error) {
      setStatus("컬렉션을 삭제하지 못했습니다. 이미 삭제됐거나 이용 권한이 없습니다.");
      return;
    }
    setStatus(`${collection.title} 컬렉션을 삭제했습니다.`);
    await loadCollections();
  }

  return (
    <section className="collection-manager" aria-labelledby="collection-heading">
      <div className="collection-heading-row">
        <div>
          <p className="eyebrow">MY RIDING COLLECTIONS</p>
          <h2 id="collection-heading">라이딩 컬렉션</h2>
        </div>
        <button className="text-button" type="button" onClick={() => void loadCollections()}>새로고침</button>
      </div>

      <div className="collection-create">
        <label><span>새 컬렉션 이름</span><input maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="예: 북한강 아침 코스" /></label>
        <label><span>설명 · 선택</span><textarea maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="도로 특징이나 주의점을 기록하세요." /></label>
        <button className="secondary-button" type="button" disabled={busyId !== null || currentPoints.length === 0} onClick={() => void saveVersion(null)}>
          {busyId === "new" ? "저장 중…" : `현재 경유지로 새 컬렉션 저장 · ${currentPoints.length}개`}
        </button>
      </div>

      {collections.length ? (
        <ul className="collection-list">
          {collections.map((collection) => (
            <li key={collection.id}>
              <div>
                <strong>{collection.title}</strong>
                <span>v{collection.latestVersion.number} · 경유지 {collection.latestVersion.points.length}개</span>
                {collection.description ? <small>{collection.description}</small> : null}
              </div>
              <div className="collection-actions">
                <button type="button" onClick={() => onApply(collection.latestVersion.points, collection.title)}>계획에 적용</button>
                <button type="button" disabled={busyId !== null || currentPoints.length === 0} onClick={() => void saveVersion(collection)}>새 버전</button>
                <button className="danger-text" type="button" disabled={busyId !== null} onClick={() => void deleteCollection(collection)}>삭제</button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="manager-status" role="status" aria-live="polite">{status}</p>
    </section>
  );
}
