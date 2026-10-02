"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { KakaoMapCanvas, type MapPoint } from "./kakao-map-canvas";
import {
  MapPointConfirmation,
  type MapPlacePickerHandle,
} from "./map-point-confirmation";
import { PlaceSearchField } from "./place-search-field";
import { useSavedPlaces } from "./saved-places-provider";
import {
  PROVINCES,
  savedPlaceName,
  type SavedPlace,
  type SavedPlaceKind,
} from "@/lib/places/saved";
import type { PlaceSearchResult } from "@/lib/places/search";
import {
  defaultDwellMinutes,
  waypointRoleOptions,
  type WaypointRole,
} from "@/lib/planner/ordered-waypoints";
import styles from "./saved-places-manager.module.css";

type Pending = {
  title: string;
  name: string;
  description: string;
  action: string;
  valid: () => boolean;
  run: () => Promise<boolean>;
  destructive?: boolean;
};

export function SavedPlacesManager(props: SavedPlacesManagerProps) {
  const { accountEpoch } = useSavedPlaces();
  return <SavedPlacesManagerContent key={accountEpoch} {...props} />;
}

type SavedPlacesManagerProps = {
  onBack: () => void;
  onAddWaypoint: (
    place: PlaceSearchResult,
    role: WaypointRole,
    dwellMinutes: number,
  ) => string | null;
  routePoints: MapPoint[];
  routePath?: { latitude: number; longitude: number }[];
  disabled?: boolean;
};

function SavedPlacesManagerContent({
  onBack,
  onAddWaypoint,
  routePoints,
  routePath,
  disabled = false,
}: SavedPlacesManagerProps) {
  const saved = useSavedPlaces();
  const [tab, setTab] = useState<"starred" | SavedPlaceKind>("riding_spot");
  const [province, setProvince] = useState("");
  const [spots, setSpots] = useState(true);
  const [restaurants, setRestaurants] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<{
    place: PlaceSearchResult | null;
    existing?: SavedPlace;
  } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [adding, setAdding] = useState<SavedPlace | null>(null);
  const [mapAttempt, setMapAttempt] = useState(0);
  const picker = useRef<MapPlacePickerHandle>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const selected = saved.places.find((p) => p.id === selectedId);
  const blocked = saved.busy || saved.status !== "ready";
  const filtered = useMemo(
    () =>
      saved.places.filter(
        (p) =>
          (!province ||
            (province === "unknown"
              ? p.province === null
              : p.province === province)) &&
          (!query.trim() ||
            `${savedPlaceName(p)} ${p.place.name} ${p.place.address}`
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase())),
      ),
    [saved.places, province, query],
  );
  const list = filtered.filter((p) =>
    tab === "starred" ? p.starSlot !== null : p.kind === tab,
  );
  const pins = filtered
    .filter(
      (p) =>
        (tab !== "starred" || p.starSlot !== null) &&
        (p.kind === "restaurant" ? restaurants : spots),
    )
    .map((p) => ({
      id: p.id,
      label: savedPlaceName(p),
      kind: p.kind,
      latitude: p.place.latitude,
      longitude: p.place.longitude,
    }));

  function confirm(p: SavedPlace, action: "star" | "delete") {
    const starred = p.starSlot === null;
    setPending({
      title:
        action === "delete"
          ? "이 장소를 삭제할까요?"
          : starred
            ? "자주 찾는 곳에 추가할까요?"
            : "자주 찾는 곳에서 뺄까요?",
      name: savedPlaceName(p),
      description:
        action === "delete"
          ? "내 저장 장소와 자주 찾는 곳에서 삭제해요. 이미 저장한 일정·코스·공유 결과는 유지됩니다."
          : starred
            ? "최대 5개까지 별표를 지정할 수 있어요."
            : "별표만 해제해요. 라이딩 스팟이나 식당 목록에는 그대로 남아 있어요.",
      action:
        action === "delete" ? "장소 삭제" : starred ? "별표 지정" : "별표 해제",
      destructive: action === "delete",
      valid: saved.captureSnapshot(),
      run: () =>
        action === "delete" ? saved.deletePlace(p) : saved.star(p, starred),
    });
  }

  return (
    <section className={styles.page} aria-labelledby="saved-places-title">
      <header className={styles.heading}>
        <div>
          <h1 id="saved-places-title" data-view-title="favorites" tabIndex={-1}>
            즐겨찾기
          </h1>
          <p>
            저장 장소 {saved.places.length.toLocaleString()} / 1,000 · 자주 찾는
            곳 {saved.favorites.length} / 5
          </p>
        </div>
        <button type="button" onClick={onBack}>
          뒤로
        </button>
      </header>
      <nav className={styles.tabs} aria-label="저장 장소 목록">
        {(
          [
            ["starred", "자주 찾는 곳"],
            ["riding_spot", "라이딩 스팟"],
            ["restaurant", "식당"],
          ] as const
        ).map(([key, label]) => (
          <button
            type="button"
            key={key}
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className={styles.filters}>
        <label>
          시·도
          <select
            value={province}
            onChange={(e) => setProvince(e.target.value)}
          >
            <option value="">전국</option>
            {PROVINCES.map((p) => (
              <option key={p}>{p}</option>
            ))}
            <option value="unknown">지역 미확인</option>
          </select>
        </label>
        <label>
          저장 장소 찾기
          <input
            value={query}
            maxLength={100}
            placeholder="별명, 장소명, 주소"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className={styles.layers} aria-label="지도 핀 표시">
        <label>
          <input
            type="checkbox"
            checked={spots}
            onChange={(e) => setSpots(e.target.checked)}
          />
          라이딩 스팟
        </label>
        <label>
          <input
            type="checkbox"
            checked={restaurants}
            onChange={(e) => setRestaurants(e.target.checked)}
          />
          식당
        </label>
      </div>
      <div className={styles.columns}>
        <div>
          <div className={styles.map}>
            <KakaoMapCanvas
              key={mapAttempt}
              points={routePoints}
              path={routePath}
              allowEmptyMap
              savedPins={pins}
              savedViewportKey={province}
              onSelectSavedPin={setSelectedId}
              showLegend={false}
              onSelectCoordinate={
                !blocked && saved.places.length < 1000
                  ? (point) => picker.current?.open(point)
                  : undefined
              }
              coordinateActionLabel="지도 중심에서 등록 위치 선택"
            />
          </div>
          <p className={styles.helper}>
            S 원형: 라이딩 스팟 · 식 사각형: 식당. 핀은 상세 정보만 열어요.
          </p>
          {!spots && !restaurants ? (
            <p role="status">
              저장 장소 핀을 모두 숨겼어요. 현재 일정의 지점과 지도는
              유지됩니다.
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => {
              // Retry only an explicitly failed loader. Keep the draft and healthy SDK.
              const script = document.querySelector<HTMLScriptElement>(
                "script[data-motocast-kakao-map]",
              );
              if (
                script?.dataset.motocastKakaoMapStatus === "error" &&
                !window.kakao?.maps
              )
                script.remove();
              setMapAttempt((n) => n + 1);
            }}
          >
            지도 다시 불러오기
          </button>
        </div>
        <section
          aria-label={`${tab === "starred" ? "자주 찾는 곳" : tab === "restaurant" ? "식당" : "라이딩 스팟"} 목록`}
        >
          <button
            ref={addButton}
            className="primary-button"
            type="button"
            disabled={blocked || saved.places.length >= 1000}
            onClick={() => setForm({ place: null })}
          >
            ＋ 장소 등록
          </button>
          {saved.status === "loading" ? (
            <p role="status">저장한 장소를 불러오는 중이에요.</p>
          ) : saved.status === "error" ? (
            <div role="alert">
              <p>{saved.message}</p>
              <button type="button" disabled={saved.busy} onClick={saved.retry}>
                목록 다시 확인
              </button>
            </div>
          ) : !list.length ? (
            <p>
              {query
                ? "조건에 맞는 저장 장소가 없어요."
                : "이 목록에 저장한 장소가 없어요."}
            </p>
          ) : (
            <ul className={styles.list}>
              {list.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    aria-label={`${savedPlaceName(p)} 상세 보기`}
                  >
                    <strong>
                      {p.starSlot !== null ? "★ " : ""}
                      {savedPlaceName(p)}
                    </strong>
                    <span>원래 장소명 · {p.place.name}</span>
                    <span>
                      {p.province ?? "지역 미확인"} ·{" "}
                      {p.place.roadAddress ?? p.place.address}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {saved.places.length >= 1000 ? (
            <p role="status">
              저장 한도에 도달했어요. 기존 장소를 정리한 뒤 등록해 주세요.
            </p>
          ) : null}
        </section>
      </div>
      {saved.message && saved.status === "ready" ? (
        <p role="status" aria-live="polite">
          {saved.message}
        </p>
      ) : null}
      {selected ? (
        <SavedDialog title="장소 상세" onClose={() => setSelectedId(null)}>
          <strong>{savedPlaceName(selected)}</strong>
          <p>원래 장소명 · {selected.place.name}</p>
          <p>
            {selected.province ?? "지역 미확인"} ·{" "}
            {selected.place.roadAddress ?? selected.place.address}
          </p>
          <button
            className="primary-button"
            type="button"
            disabled={blocked || disabled}
            onClick={() => setAdding(selected)}
          >
            경유지에 추가
          </button>
          <button
            type="button"
            disabled={
              blocked ||
              (selected.starSlot === null && saved.favorites.length >= 5)
            }
            onClick={() => confirm(selected, "star")}
          >
            {selected.starSlot === null
              ? "☆ 자주 찾는 곳에 추가"
              : "★ 별표 해제"}
          </button>
          {selected.starSlot === null && saved.favorites.length >= 5 ? (
            <p>
              자주 찾는 곳 5개가 모두 찼어요. 다른 별표를 먼저 해제해 주세요.
            </p>
          ) : null}
          <button
            type="button"
            disabled={blocked}
            onClick={() =>
              setForm({ place: selected.place, existing: selected })
            }
          >
            별명·분류 수정
          </button>
          <button
            type="button"
            disabled={blocked}
            onClick={() => confirm(selected, "delete")}
          >
            장소 삭제
          </button>
        </SavedDialog>
      ) : null}
      {adding ? (
        <SavedWaypointForm
          place={adding}
          disabled={blocked || disabled}
          onClose={() => setAdding(null)}
          onAdd={(role, dwell) => {
            const failure = onAddWaypoint(adding.place, role, dwell);
            if (!failure) {
              setAdding(null);
              setSelectedId(null);
            }
            return failure;
          }}
        />
      ) : null}
      <MapPointConfirmation
        pickerRef={picker}
        purpose="saved-place"
        onSelect={(place) => setForm({ place })}
      />
      {form ? (
        <SavedPlaceForm
          initial={form.place}
          existing={form.existing}
          stars={saved.favorites.length}
          blocked={blocked}
          onClose={() => {
            setForm(null);
            addButton.current?.focus();
          }}
          onSave={(place, alias, kind, starred) => {
            const existing = form.existing;
            setPending({
              title: existing
                ? "장소 정보를 수정할까요?"
                : "이 장소를 저장할까요?",
              name: alias.trim() || place.name,
              description: `${kind === "restaurant" ? "식당" : "라이딩 스팟"} · 원래 장소명 ${place.name}${starred ? " · 자주 찾는 곳에 추가" : ""}`,
              action: existing ? "확인하고 수정" : "확인하고 저장",
              valid: saved.captureSnapshot(),
              run: async () => {
                const ok = await (existing
                  ? saved.edit(existing, alias, kind)
                  : saved.save(place, alias, kind, starred));
                if (ok) setForm(null);
                return ok;
              },
            });
          }}
        />
      ) : null}
      {pending ? (
        <SavedConfirmation
          pending={pending}
          busy={saved.busy}
          onClose={() => setPending(null)}
        />
      ) : null}
    </section>
  );
}

function SavedDialog({
  title,
  onClose,
  children,
  locked = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  locked?: boolean;
}) {
  const id = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const focus = document.activeElement;
    ref.current?.showModal();
    return () => {
      if (focus instanceof HTMLElement && focus.isConnected) focus.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!locked) onClose();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <header>
        <h2 id={id}>{title}</h2>
        <button
          type="button"
          aria-label={`${title} 닫기`}
          disabled={locked}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}

function SavedPlaceForm({
  initial,
  existing,
  stars,
  blocked,
  onClose,
  onSave,
}: {
  initial: PlaceSearchResult | null;
  existing?: SavedPlace;
  stars: number;
  blocked: boolean;
  onClose: () => void;
  onSave: (
    p: PlaceSearchResult,
    a: string,
    k: SavedPlaceKind,
    s: boolean,
  ) => void;
}) {
  const [place, setPlace] = useState(initial);
  const [alias, setAlias] = useState(existing?.alias ?? "");
  const [kind, setKind] = useState<SavedPlaceKind>(
    existing?.kind ?? "riding_spot",
  );
  const [starred, setStarred] = useState(false);
  return (
    <SavedDialog
      title={existing ? "별명·분류 수정" : "장소 등록"}
      onClose={onClose}
    >
      {!existing ? (
        <PlaceSearchField
          label="저장할 장소"
          placeholder="장소명 또는 주소 검색"
          selected={place}
          onSelect={setPlace}
          selectionActionLabel="이 장소 선택"
        />
      ) : null}
      {place ? (
        <>
          <p>원래 장소명 · {place.name}</p>
          <p>{place.roadAddress ?? place.address}</p>
        </>
      ) : (
        <p>
          검색 결과에서 장소를 선택하세요. 지도 등록은 이 창을 닫고 지도를 길게
          눌러 시작해요.
        </p>
      )}
      <label>
        분류
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as SavedPlaceKind)}
        >
          <option value="riding_spot">라이딩 스팟</option>
          <option value="restaurant">식당</option>
        </select>
      </label>
      <label>
        별명 (선택, 최대 80자)
        <input
          value={alias}
          maxLength={160}
          onChange={(e) => setAlias([...e.target.value].slice(0, 80).join(""))}
        />
      </label>
      <p>별명을 비워 두면 원래 장소명으로 표시해요.</p>
      {!existing ? (
        <label>
          <input
            type="checkbox"
            checked={starred}
            disabled={stars >= 5}
            onChange={(e) => setStarred(e.target.checked)}
          />
          자주 찾는 곳에 추가 ({stars}/5)
        </label>
      ) : null}
      <button
        type="button"
        className="primary-button"
        disabled={!place || blocked || (starred && stars >= 5)}
        onClick={() => place && onSave(place, alias, kind, starred)}
      >
        {existing ? "수정 내용 확인" : "저장 내용 확인"}
      </button>
    </SavedDialog>
  );
}

function SavedWaypointForm({
  place,
  disabled,
  onClose,
  onAdd,
}: {
  place: SavedPlace;
  disabled: boolean;
  onClose: () => void;
  onAdd: (role: WaypointRole, dwell: number) => string | null;
}) {
  const [role, setRole] = useState<WaypointRole>("waypoint");
  const [dwell, setDwell] = useState(0);
  const [error, setError] = useState("");
  return (
    <SavedDialog title="경유지 추가 확인" onClose={onClose}>
      <strong>{savedPlaceName(place)}</strong>
      <p>
        도착지 바로 앞에 추가해요. 경로와 날씨는 경로 다시 계산을 눌러 갱신해요.
      </p>
      <label>
        역할
        <select
          value={role}
          onChange={(e) => {
            const next = e.target.value as WaypointRole;
            setRole(next);
            setDwell(defaultDwellMinutes(next));
          }}
        >
          {waypointRoleOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {role !== "waypoint" ? (
        <label>
          정차 시간 (분)
          <input
            type="number"
            min={1}
            max={1440}
            value={dwell}
            onChange={(e) => setDwell(Number(e.target.value))}
          />
        </label>
      ) : (
        <p>정차 없이 통과해요.</p>
      )}
      {error ? <p role="alert">{error}</p> : null}
      <div className={styles.actions}>
        <button
          className="primary-button"
          type="button"
          disabled={disabled}
          onClick={() => {
            if (
              role !== "waypoint" &&
              (!Number.isInteger(dwell) || dwell < 1 || dwell > 1440)
            ) {
              setError("정차 시간은 1~1440분으로 입력해 주세요.");
              return;
            }
            setError(onAdd(role, role === "waypoint" ? 0 : dwell) ?? "");
          }}
        >
          확인하고 추가
        </button>
        <button type="button" onClick={onClose}>
          취소
        </button>
      </div>
    </SavedDialog>
  );
}

function SavedConfirmation({
  pending,
  busy,
  onClose,
}: {
  pending: Pending;
  busy: boolean;
  onClose: () => void;
}) {
  const started = useRef(false);
  const mounted = useRef(false);
  const [running, setRunning] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const valid = pending.valid();
  async function confirm() {
    if (started.current || busy || !pending.valid()) return;
    started.current = true;
    setRunning(true);
    try {
      const ok = await pending.run();
      if (mounted.current) {
        if (ok) onClose();
        else setFailed(true);
      }
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      if (mounted.current) setRunning(false);
    }
  }
  return (
    <SavedDialog title={pending.title} locked={running} onClose={onClose}>
      <strong>{pending.name}</strong>
      <p>{pending.description}</p>
      {!valid && !running ? (
        <p role="alert">
          목록이나 계정이 바뀌었어요. 닫고 최신 장소를 다시 선택해 주세요.
        </p>
      ) : null}
      {failed ? (
        <p role="alert">
          변경을 확인하지 못했어요. 창을 닫고 목록 상태를 확인해 주세요.
        </p>
      ) : null}
      <div className={styles.actions}>
        <button
          type="button"
          className={pending.destructive ? styles.danger : "primary-button"}
          disabled={busy || running || !valid || failed}
          onClick={() => void confirm()}
        >
          {running ? "처리 중" : pending.action}
        </button>
        <button type="button" disabled={running} onClick={onClose}>
          취소
        </button>
      </div>
    </SavedDialog>
  );
}
