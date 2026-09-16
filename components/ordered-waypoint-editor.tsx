"use client";

import { useRef, useState } from "react";

import { PlaceSearchField, type PlaceFavoritesControls } from "@/components/place-search-field";
import {
  defaultDwellMinutes,
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
  selectionRevision: number;
  waypoints: EditableWaypoint[];
  onChange: (waypoints: EditableWaypoint[]) => void;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
};

export function OrderedWaypointEditor({
  connected,
  disabled = false,
  favorites,
  selectionRevision,
  waypoints,
  onChange,
  onStatus,
  onError,
}: Props) {
  const [roleToAdd, setRoleToAdd] = useState<WaypointRole>("waypoint");
  const [settingId, setSettingId] = useState<string | null>(null);
  const [settingRole, setSettingRole] = useState<WaypointRole>("waypoint");
  const [settingDwell, setSettingDwell] = useState(0);
  const [settingError, setSettingError] = useState("");
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const settingsDialogRef = useRef<HTMLDialogElement>(null);
  const settingsErrorRef = useRef<HTMLParagraphElement>(null);

  function focusWaypoint(id: string, selector = ".place-picker-trigger") {
    window.setTimeout(() => {
      const item = [...document.querySelectorAll<HTMLElement>("[data-waypoint-id]")]
        .find((candidate) => candidate.dataset.waypointId === id);
      item?.querySelector<HTMLElement>(selector)?.focus();
    }, 0);
  }

  function addWaypoint() {
    const error = roleAssignmentError(waypoints, roleToAdd);
    if (error) {
      onError(error);
      return;
    }
    const id = crypto.randomUUID();
    const next = [...waypoints, {
      id,
      role: roleToAdd,
      place: null,
      dwellMinutes: defaultDwellMinutes(roleToAdd),
    }];
    onChange(next);
    onStatus(`${waypointRoleLabel(roleToAdd)}을(를) ${next.length}번째에 추가했습니다. 장소를 선택해 주세요.`);
    focusWaypoint(id);
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
    setSettingRole(waypoint.role);
    setSettingDwell(waypoint.dwellMinutes);
    setSettingError("");
    settingsDialogRef.current?.showModal();
  }

  function applySettings() {
    if (!settingId) return;
    const current = waypoints.find((waypoint) => waypoint.id === settingId);
    if (!current) return;
    const roleError = roleAssignmentError(waypoints, settingRole, settingId);
    if (roleError) { setSettingError(roleError); onError(roleError); window.setTimeout(() => settingsErrorRef.current?.focus(), 0); return; }
    const dwellMinutes = settingRole === "waypoint" ? 0 : settingDwell;
    if (!Number.isInteger(dwellMinutes) || (settingRole !== "waypoint" && (dwellMinutes < 1 || dwellMinutes > 1440))) {
      const message = "머무는 시간은 1분 이상 1440분 이하로 정해 주세요.";
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
                  <span>{roleLabel}{waypoint.role === "waypoint" ? " · 통과" : ` · ${waypoint.dwellMinutes}분 정차`}</span>
                </div>
                <PlaceSearchField
                  key={`${waypoint.id}-${selectionRevision}`}
                  label={`${index + 1}번째 ${roleLabel} 장소`}
                  placeholder={waypoint.role === "waypoint" ? "고개, 전망대, 지나갈 장소" : "식당, 카페, 휴게소"}
                  required
                  selected={waypoint.place}
                  favorites={favorites}
                  onSelect={(place) => onChange(waypoints.map((item) => item.id === waypoint.id ? { ...item, place } : item))}
                />
                <div className="waypoint-actions">
                  <button className="waypoint-move-up" type="button" disabled={index === 0} onClick={() => reorder(index, -1)} aria-label={`${index + 1}번째 ${roleLabel} 위로 이동`}>↑</button>
                  <button className="waypoint-move-down" type="button" disabled={index === waypoints.length - 1} onClick={() => reorder(index, 1)} aria-label={`${index + 1}번째 ${roleLabel} 아래로 이동`}>↓</button>
                  <button className="waypoint-settings" type="button" onClick={() => openSettings(waypoint)} aria-label={`경유 ${index + 1} 설정`}>설정</button>
                </div>
              </li>
            );
          })}
        </ol>
      ) : <p className="waypoint-empty">추가한 경유지가 없습니다. 출발지에서 복귀지까지 바로 계산할 수 있습니다.</p>}

      <div className="waypoint-add-row">
        <label>
          <span>추가할 종류</span>
          <select aria-label="추가할 종류" value={roleToAdd} onChange={(event) => setRoleToAdd(event.target.value as WaypointRole)} disabled={!connected || disabled}>
            {waypointRoleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <button
          ref={addButtonRef}
          className="text-button"
          type="button"
          disabled={!connected || disabled || waypoints.length >= waypointLimits.total}
          onClick={addWaypoint}
        >
          + 경유지 추가 · {waypoints.length}/{waypointLimits.total}
        </button>
      </div>
      <dialog ref={settingsDialogRef} className="waypoint-settings-dialog" aria-label="경유지 설정">
        <div className="waypoint-settings-shell">
          <header><h2>경유지 설정</h2><button type="button" onClick={() => settingsDialogRef.current?.close()} aria-label="경유지 설정 닫기">×</button></header>
          <fieldset><legend>경유 종류</legend><div className="waypoint-role-pills">{waypointRoleOptions.map((option) => <button type="button" key={option.value} aria-pressed={settingRole === option.value} onClick={() => { if (option.value !== settingRole) setSettingDwell(defaultDwellMinutes(option.value)); setSettingRole(option.value); setSettingError(""); }}>{option.value === "waypoint" ? "통과" : option.label}</button>)}</div></fieldset>
          {settingRole !== "waypoint" ? <div className="dwell-stepper"><span>머무는 시간</span><button type="button" aria-label="머무는 시간 10분 줄이기" onClick={() => setSettingDwell((value) => Math.max(1, value - 10))}>−</button><strong>{settingDwell}분</strong><button type="button" aria-label="머무는 시간 10분 늘리기" onClick={() => setSettingDwell((value) => Math.min(1440, value + 10))}>＋</button></div> : null}
          {settingError ? <p ref={settingsErrorRef} className="waypoint-settings-error" role="alert" tabIndex={-1}>{settingError}</p> : null}
          <div className="waypoint-settings-actions"><button className="danger-text" type="button" onClick={() => { if (settingId) removeWaypoint(settingId); settingsDialogRef.current?.close(); }}>경유지 삭제</button><button className="primary-button" type="button" onClick={applySettings}>설정 적용</button></div>
        </div>
      </dialog>
      <p className="waypoint-help">점심·저녁은 각각 1개, 휴식은 5개, 일반 경유지는 20개까지 추가할 수 있습니다. 위아래 버튼으로 실제 방문 순서를 정하세요.</p>
    </div>
  );
}
