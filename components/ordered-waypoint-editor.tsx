"use client";

import { useRef, useState } from "react";

import { PlaceSearchField } from "@/components/place-search-field";
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
  selectionRevision: number;
  waypoints: EditableWaypoint[];
  onChange: (waypoints: EditableWaypoint[]) => void;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
};

export function OrderedWaypointEditor({
  connected,
  disabled = false,
  selectionRevision,
  waypoints,
  onChange,
  onStatus,
  onError,
}: Props) {
  const [roleToAdd, setRoleToAdd] = useState<WaypointRole>("waypoint");
  const addButtonRef = useRef<HTMLButtonElement>(null);

  function focusWaypoint(id: string, selector = "input") {
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

  function changeRole(id: string, role: WaypointRole) {
    const current = waypoints.find((waypoint) => waypoint.id === id);
    if (!current || current.role === role) return;
    const error = roleAssignmentError(waypoints, role, id);
    if (error) {
      onError(error);
      return;
    }
    onChange(waypoints.map((waypoint) => waypoint.id === id
      ? { ...waypoint, role, dwellMinutes: defaultDwellMinutes(role) }
      : waypoint));
    onStatus(`${waypointRoleLabel(current.role)}을(를) ${waypointRoleLabel(role)}으로 변경했습니다.`);
  }

  function removeWaypoint(id: string) {
    const index = waypoints.findIndex((waypoint) => waypoint.id === id);
    const removed = waypoints[index];
    if (!removed) return;
    const focusId = waypoints[index + 1]?.id ?? waypoints[index - 1]?.id;
    onChange(waypoints.filter((waypoint) => waypoint.id !== id));
    onStatus(`${waypointRoleLabel(removed.role)}을(를) 경로에서 제거했습니다.`);
    window.setTimeout(() => {
      if (focusId) focusWaypoint(focusId, ".waypoint-remove");
      else addButtonRef.current?.focus();
    }, 0);
  }

  function reorder(index: number, direction: -1 | 1) {
    const waypoint = waypoints[index];
    const reordered = moveWaypoint(waypoints, index, direction);
    if (!waypoint || reordered === waypoints) return;
    onChange(reordered);
    onStatus(`${waypoint.place?.name ?? waypointRoleLabel(waypoint.role)}을(를) ${index + direction + 1}번째로 이동했습니다.`);
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
                  <span className="waypoint-position">{String(index + 1).padStart(2, "0")}</span>
                  <strong>{index + 1}번째 경유지</strong>
                  <span>{roleLabel}{waypoint.role === "waypoint" ? " · 통과" : ` · ${waypoint.dwellMinutes}분 정차`}</span>
                </div>
                <label className="waypoint-role-field">
                  <span>종류</span>
                  <select
                    aria-label={`${index + 1}번째 경유지 종류`}
                    value={waypoint.role}
                    onChange={(event) => changeRole(waypoint.id, event.target.value as WaypointRole)}
                  >
                    {waypointRoleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <PlaceSearchField
                  key={`${waypoint.id}-${selectionRevision}`}
                  label={`${index + 1}번째 ${roleLabel} 장소`}
                  placeholder={waypoint.role === "waypoint" ? "고개, 전망대, 지나갈 장소" : "식당, 카페, 휴게소"}
                  required
                  selected={waypoint.place}
                  onSelect={(place) => onChange(waypoints.map((item) => item.id === waypoint.id ? { ...item, place } : item))}
                />
                {waypoint.role !== "waypoint" ? (
                  <label className="waypoint-dwell-field">
                    <span>{index + 1}번째 {roleLabel} 머무는 시간 · 분</span>
                    <input
                      aria-label={`${index + 1}번째 ${roleLabel} 머무는 시간 · 분`}
                      type="number"
                      min={1}
                      max={1440}
                      step={1}
                      value={waypoint.dwellMinutes}
                      onChange={(event) => {
                        const dwellMinutes = Number(event.target.value);
                        if (!Number.isInteger(dwellMinutes) || dwellMinutes < 1 || dwellMinutes > 1440) return;
                        onChange(waypoints.map((item) => item.id === waypoint.id ? { ...item, dwellMinutes } : item));
                      }}
                    />
                  </label>
                ) : null}
                <div className="waypoint-actions">
                  <button type="button" disabled={index === 0} onClick={() => reorder(index, -1)} aria-label={`${index + 1}번째 ${roleLabel} 위로 이동`}>↑ 위로</button>
                  <button type="button" disabled={index === waypoints.length - 1} onClick={() => reorder(index, 1)} aria-label={`${index + 1}번째 ${roleLabel} 아래로 이동`}>↓ 아래로</button>
                  <button className="danger-text waypoint-remove" type="button" onClick={() => removeWaypoint(waypoint.id)} aria-label={`${index + 1}번째 ${roleLabel} 제거`}>제거</button>
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
      <p className="waypoint-help">점심·저녁은 각각 1개, 휴식은 5개, 일반 경유지는 20개까지 추가할 수 있습니다. 위아래 버튼으로 실제 방문 순서를 정하세요.</p>
    </div>
  );
}
