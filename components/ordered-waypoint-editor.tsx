"use client";

import { LineIcon } from "@/components/line-icon";
import { useEffect, useRef, useState } from "react";

import { PlaceSearchField, type PlaceFavoritesControls } from "@/components/place-search-field";
import { SavedPlacesManager } from "@/components/saved-places-manager";
import { placeAddressLine, type PlaceSearchResult } from "@/lib/places/search";
import {
  defaultDwellMinutes,
  dwellError,
  dwellForRole,
  isMealRole,
  MEAL_DWELL_NOTE,
  moveWaypoint,
  roleAssignmentError,
  waypointLimits,
  waypointRoleLabel,
  waypointRoleOptions,
  type EditableWaypoint,
  type WaypointRole,
} from "@/lib/planner/ordered-waypoints";

type Props = {
  connected: boolean;
  disabled?: boolean;
  favorites?: PlaceFavoritesControls;
  /** Each time a waypoint place picker opens. */
  onPickerOpen?: () => void;
  selectionRevision: number;
  waypoints: EditableWaypoint[];
  onChange: (waypoints: EditableWaypoint[]) => void;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
  onPlaceTarget?: (id: string) => void;
};

export function OrderedWaypointEditor({
  connected,
  disabled = false,
  favorites,
  onPickerOpen,
  selectionRevision,
  waypoints,
  onChange,
  onStatus,
  onError,
  onPlaceTarget,
}: Props) {
  const [settingId, setSettingId] = useState<string | null>(null);
  const [settingMode, setSettingMode] = useState<"add" | "edit" | null>(null);
  const [settingRole, setSettingRole] = useState<WaypointRole>("waypoint");
  const [settingDwell, setSettingDwell] = useState(0);
  const [settingError, setSettingError] = useState("");
  const [choosingSaved, setChoosingSaved] = useState(false);
  const savedDialogRef = useRef<HTMLDialogElement>(null);
  const savedEntryRef = useRef<HTMLButtonElement>(null);
  const addedSavedRef = useRef(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const settingsDialogRef = useRef<HTMLDialogElement>(null);
  const settingsErrorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (choosingSaved) savedDialogRef.current?.showModal();
  }, [choosingSaved]);

  function openSavedPlaces() {
    if (!connected || disabled || !favorites) return;
    addedSavedRef.current = false;
    settingsDialogRef.current?.close();
    setChoosingSaved(true);
  }

  function backFromSavedPlaces() {
    setChoosingSaved(false);
    settingsDialogRef.current?.showModal();
    window.setTimeout(() => savedEntryRef.current?.focus(), 0);
  }

  function addSavedPlace(place: PlaceSearchResult, role: WaypointRole, dwellMinutes: number): string | null {
    if (addedSavedRef.current || !connected || disabled || favorites?.status !== "ready") return "장소 목록을 다시 열어 선택해 주세요.";
    const error = roleAssignmentError(waypoints, role);
    if (error) return error;
    const invalidDwell = dwellError(role, dwellMinutes);
    if (invalidDwell) return invalidDwell;
    addedSavedRef.current = true;
    const id = crypto.randomUUID();
    onChange([...waypoints, { id, place, role, dwellMinutes }]);
    onStatus(`${place.name}을(를) 경유지에 추가했습니다. 방문 순서를 확인해 주세요.`);
    setChoosingSaved(false);
    setSettingMode(null);
    focusWaypoint(id, ".waypoint-settings");
    return null;
  }

  function focusWaypoint(id: string, selector = ".place-picker-trigger", activate = false) {
    window.setTimeout(() => {
      const item = [...document.querySelectorAll<HTMLElement>("[data-waypoint-id]")]
        .find((candidate) => candidate.dataset.waypointId === id);
      const target = item?.querySelector<HTMLElement>(selector);
      target?.focus();
      if (activate) target?.click();
    }, 0);
  }

  function startAddingWaypoint() {
    setSettingId(null);
    setSettingMode("add");
    setSettingRole("waypoint");
    setSettingDwell(0);
    setSettingError("");
    settingsDialogRef.current?.showModal();
  }

  function removeWaypoint(id: string) {
    const index = waypoints.findIndex((waypoint) => waypoint.id === id);
    const removed = waypoints[index];
    if (!removed) return;
    const focusId = waypoints[index + 1]?.id ?? waypoints[index - 1]?.id;
    onChange(waypoints.filter((waypoint) => waypoint.id !== id));
    onStatus(`${waypointRoleLabel(removed.role)}을(를) 경로에서 제거했습니다.`);
    window.setTimeout(() => {
      if (focusId) focusWaypoint(focusId, ".waypoint-settings");
      else addButtonRef.current?.focus();
    }, 0);
  }

  function reorder(index: number, direction: -1 | 1) {
    const waypoint = waypoints[index];
    const reordered = moveWaypoint(waypoints, index, direction);
    if (!waypoint || reordered === waypoints) return;
    const nextIndex = index + direction;
    onChange(reordered);
    onStatus(`${waypoint.place?.name ?? waypointRoleLabel(waypoint.role)}을(를) ${nextIndex + 1}번째로 이동했습니다.`);
    const focusSelector = direction === -1
      ? nextIndex === 0 ? ".waypoint-move-down" : ".waypoint-move-up"
      : nextIndex === reordered.length - 1 ? ".waypoint-move-up" : ".waypoint-move-down";
    focusWaypoint(waypoint.id, focusSelector);
  }

  function openSettings(waypoint: EditableWaypoint) {
    setSettingId(waypoint.id);
    setSettingMode("edit");
    setSettingRole(waypoint.role === "lunch" || waypoint.role === "dinner" ? "meal" : waypoint.role);
    setSettingDwell(waypoint.dwellMinutes);
    setSettingError("");
    settingsDialogRef.current?.showModal();
  }

  function applySettings() {
    if (!settingMode) return;
    if (settingMode === "add") {
      const roleError = roleAssignmentError(waypoints, settingRole);
      if (roleError) { setSettingError(roleError); onError(roleError); window.setTimeout(() => settingsErrorRef.current?.focus(), 0); return; }
      const dwellMinutes = dwellForRole(settingRole, settingDwell);
      const message = dwellError(settingRole, dwellMinutes);
      if (message) {
        setSettingError(message); onError(message); window.setTimeout(() => settingsErrorRef.current?.focus(), 0); return;
      }
      const id = crypto.randomUUID();
      const next = [...waypoints, { id, role: settingRole, place: null, dwellMinutes }];
      onChange(next);
      onStatus(`${waypointRoleLabel(settingRole)}을(를) ${next.length}번째에 추가했습니다. 장소를 선택해 주세요.`);
      settingsDialogRef.current?.close();
      focusWaypoint(id, ".place-picker-trigger", true);
      return;
    }
    if (!settingId) return;
    const current = waypoints.find((waypoint) => waypoint.id === settingId);
    if (!current) return;
    const roleError = roleAssignmentError(waypoints, settingRole, settingId);
    if (roleError) { setSettingError(roleError); onError(roleError); window.setTimeout(() => settingsErrorRef.current?.focus(), 0); return; }
    const dwellMinutes = dwellForRole(settingRole, settingDwell);
    const message = dwellError(settingRole, dwellMinutes);
    if (message) {
      setSettingError(message);
      onError(message);
      window.setTimeout(() => settingsErrorRef.current?.focus(), 0);
      return;
    }
    onChange(waypoints.map((waypoint) => waypoint.id === settingId ? { ...waypoint, role: settingRole, dwellMinutes } : waypoint));
    onStatus(`${waypointRoleLabel(settingRole)} 설정을 적용했습니다.`);
    settingsDialogRef.current?.close();
  }

  return (
    <div className="waypoint-editor">
      {waypoints.length ? (
        <ol className="ordered-waypoints" aria-label="경유지 방문 순서">
          {waypoints.map((waypoint, index) => {
            const roleLabel = waypointRoleLabel(waypoint.role);
            return (
              <li className="ordered-waypoint waypoint-card" key={waypoint.id} data-waypoint-id={waypoint.id}>
                <div className="waypoint-heading">
                  <strong>경유 {index + 1}</strong>
                  <span className="waypoint-role-label">{waypoint.role === "waypoint" ? "통과" : `${roleLabel} ${waypoint.dwellMinutes}분`}</span>
                </div>
                <PlaceSearchField
                  key={`${waypoint.id}-${selectionRevision}`}
                  label={`${index + 1}번째 ${roleLabel} 장소`}
                  placeholder={waypoint.role === "waypoint" ? "고개, 전망대, 지나갈 장소" : "식당, 카페, 휴게소"}
                  required
                  selected={waypoint.place}
                  presentation="waypoint"
                  favorites={favorites}
                  onActivate={() => onPlaceTarget?.(waypoint.id)}
                  onOpen={onPickerOpen}
                  onSelect={(place) => onChange(waypoints.map((item) => item.id === waypoint.id ? { ...item, place } : item))}
                />
                <div className="waypoint-actions">
                  <button className="waypoint-move-up" type="button" disabled={index === 0} onClick={() => reorder(index, -1)} aria-label={`${index + 1}번째 ${roleLabel} 위로 이동`}><LineIcon name="chevron-up" /></button>
                  <button className="waypoint-move-down" type="button" disabled={index === waypoints.length - 1} onClick={() => reorder(index, 1)} aria-label={`${index + 1}번째 ${roleLabel} 아래로 이동`}><LineIcon name="chevron-down" /></button>
                  <button className="waypoint-settings" type="button" onClick={() => openSettings(waypoint)} aria-label={`경유 ${index + 1} 설정`}>{waypoint.role === "waypoint" ? "통과" : `${roleLabel} ${waypoint.dwellMinutes}분`}</button>
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}

      <div className="waypoint-add-row">
        <button
          ref={addButtonRef}
          aria-label="+ 경유지 추가"
          className="text-button"
          type="button"
          disabled={!connected || disabled || waypoints.length >= waypointLimits.total}
          onClick={startAddingWaypoint}
        >
          <LineIcon name="plus" /> 경유지 추가
        </button>
      </div>
      <dialog ref={settingsDialogRef} className="waypoint-settings-dialog" aria-label="경유지 설정">
        <div className="waypoint-settings-shell">
          <header><h2>{settingMode === "add" ? "경유지 추가" : "경유지 설정"}</h2><button type="button" onClick={() => settingsDialogRef.current?.close()} aria-label="경유지 설정 닫기"><LineIcon name="close" /></button></header>
          {settingMode === "edit" && settingId ? <div className="waypoint-setting-place"><strong>{waypoints.find((item) => item.id === settingId)?.place?.name ?? "장소 미선택"}</strong>{(() => { const place = waypoints.find((item) => item.id === settingId)?.place; const line = place ? placeAddressLine(place, place.name) : "장소를 선택해 주세요."; return line ? <span>{line}</span> : null; })()}<button type="button" onClick={() => { const id = settingId; settingsDialogRef.current?.close(); focusWaypoint(id, ".place-picker-trigger", true); }}>장소 주소 변경</button></div> : null}
          <fieldset><legend>경유 종류</legend><div className="waypoint-role-pills">{waypointRoleOptions.map((option) => <button type="button" key={option.value} aria-pressed={settingRole === option.value} onClick={() => { if (option.value !== settingRole) setSettingDwell(defaultDwellMinutes(option.value)); setSettingRole(option.value); setSettingError(""); }}>{settingRole === option.value ? <LineIcon name="check" /> : null}{option.value === "waypoint" ? "통과" : option.label}</button>)}</div></fieldset>
          {isMealRole(settingRole) ? <p className="meal-dwell-note">{MEAL_DWELL_NOTE}</p> : settingRole === "rest" ? <div className="dwell-stepper"><span>머무는 시간</span><button type="button" aria-label="머무는 시간 10분 줄이기" onClick={() => setSettingDwell((value) => Math.max(1, value - 10))}><LineIcon name="minus" /></button><strong>{settingDwell}분</strong><button type="button" aria-label="머무는 시간 10분 늘리기" onClick={() => setSettingDwell((value) => Math.min(1440, value + 10))}><LineIcon name="plus" /></button></div> : null}
          {settingMode === "add" ? <button ref={savedEntryRef} className="waypoint-saved-entry" type="button" disabled={!connected || disabled || !favorites} onClick={openSavedPlaces}>즐겨찾기에서 선택</button> : null}
          {settingError ? <p ref={settingsErrorRef} className="waypoint-settings-error" role="alert" tabIndex={-1}>{settingError}</p> : null}
          <div className="waypoint-settings-actions">{settingMode === "edit" ? <button className="danger-text" type="button" onClick={() => { if (settingId) removeWaypoint(settingId); settingsDialogRef.current?.close(); }}>경유지 삭제</button> : <button type="button" onClick={() => settingsDialogRef.current?.close()}>취소</button>}<button className="primary-button" type="button" onClick={applySettings}>{settingMode === "add" ? "추가하고 장소 선택" : "설정 적용"}</button></div>
        </div>
      </dialog>
      {choosingSaved ? <dialog ref={savedDialogRef} className="waypoint-saved-dialog" aria-label="경유지 즐겨찾기 선택" onCancel={(event) => { event.preventDefault(); backFromSavedPlaces(); }}>
        <SavedPlacesManager
          onBack={backFromSavedPlaces}
          onAddWaypoint={addSavedPlace}
          initialWaypoint={{ role: settingRole, dwellMinutes: dwellForRole(settingRole, settingDwell) }}
          routePoints={[]}
          disabled={disabled}
        />
      </dialog> : null}
    </div>
  );
}
