"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { designTokens } from "@/packages/shared-ui/src/design-tokens";
import { LineIcon } from "@/components/line-icon";
import { bindMapLongPress } from "@/lib/places/map-long-press";

export type MapMarkerRole = "origin" | "destination" | "meal" | "lunch" | "dinner" | "rest" | "waypoint";
export type MapPoint = { label: string; latitude: number; longitude: number; role?: MapMarkerRole; nonTraversed?: boolean };
type PathPoint = { latitude: number; longitude: number };
export type SavedMapPin = PathPoint & { id: string; label: string; kind: "riding_spot" | "restaurant" };
type MapDisplayState = "empty" | "loading" | "ready" | "demo" | "error";
const KAKAO_MAP_LOAD_TIMEOUT_MS = 10_000;
const markerAppearance: Record<MapMarkerRole, { label: string; symbol: string; color: string }> = {
  origin: { label: "출발", symbol: "출", color: designTokens["text-primary"] },
  destination: { label: "복귀", symbol: "도", color: designTokens["text-primary"] },
  meal: { label: "식사", symbol: "식", color: designTokens["text-primary"] },
  lunch: { label: "식사", symbol: "식", color: designTokens["text-primary"] },
  dinner: { label: "식사", symbol: "식", color: designTokens["text-primary"] },
  rest: { label: "휴식", symbol: "휴", color: designTokens["text-primary"] },
  waypoint: { label: "경유", symbol: "경", color: designTokens["text-primary"] },
};

function markerImage(maps: KakaoMapsNamespace, points: MapPoint[], selectionPreview = false) {
  if (selectionPreview) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48" viewBox="0 0 40 48"><path d="M20 2C10.06 2 2 10.06 2 20C2 32 20 46 20 46C20 46 38 32 38 20C38 10.06 29.94 2 20 2Z" fill="${designTokens["signal-fill"]}" stroke="${designTokens["text-primary"]}" stroke-width="2"/><path d="M20 12V28M12 20H28" stroke="${designTokens["text-primary"]}" stroke-width="2" stroke-linecap="round"/></svg>`;
    return new maps.MarkerImage(`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, new maps.Size(40, 48), { offset: new maps.Point(20, 46) });
  }
  const markerKinds = Array.from(new Map(points.map((point) => {
    const role = point.role ?? "waypoint";
    return [`${role}:${Boolean(point.nonTraversed)}`, { role, nonTraversed: Boolean(point.nonTraversed) }] as const;
  })).values());
  if (markerKinds.length > 1 || markerKinds[0].nonTraversed) {
    const width = 12 + markerKinds.length * 26;
    const center = width / 2;
    const badges = markerKinds.map(({ role, nonTraversed }, index) => {
      const appearance = markerAppearance[role];
      const cx = 19 + index * 26;
      return `<rect x="${cx - 11}" y="7" width="22" height="22" rx="4" fill="${appearance.color}"/><text x="${cx}" y="21.5" text-anchor="middle" font-family="sans-serif" font-size="11" font-weight="700" fill="${designTokens["surface-card"]}">${appearance.symbol}</text>${nonTraversed ? `<path d="M${cx + 5} 8l6 6m0-6l-6 6" stroke="${designTokens["danger-on"]}" stroke-width="2"/>` : ""}`;
    }).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="44" viewBox="0 0 ${width} 44"><path d="M${center - 6} 33 L${center} 43 L${center + 6} 33Z" fill="${designTokens["text-primary"]}"/><rect x="1" y="1" width="${width - 2}" height="34" rx="5" fill="${designTokens["text-primary"]}"/>${badges}</svg>`;
    return new maps.MarkerImage(
      `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
      new maps.Size(width, 44),
      { offset: new maps.Point(center, 43) },
    );
  }
  const appearance = markerAppearance[markerKinds[0].role];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44"><rect x="3" y="8" width="30" height="28" rx="5" fill="${appearance.color}"/><path d="M13 35L18 43L23 35" fill="${appearance.color}"/><text x="18" y="27" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="700" fill="${designTokens["surface-card"]}">${appearance.symbol}</text></svg>`;
  return new maps.MarkerImage(
    `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    new maps.Size(36, 44),
    { offset: new maps.Point(18, 43) },
  );
}

function markerGroups(points: MapPoint[]) {
  const groups = new Map<string, { latitude: number; longitude: number; points: MapPoint[] }>();
  points.forEach((point) => {
    const key = `${point.latitude}:${point.longitude}`;
    const group = groups.get(key);
    if (group) group.points.push(point);
    else groups.set(key, { latitude: point.latitude, longitude: point.longitude, points: [point] });
  });
  return Array.from(groups.values());
}

export function KakaoMapCanvas({
  points,
  path,
  showLegend = true,
  onSelectCoordinate,
  selectionPreview = false,
  savedPins = [],
  onSelectSavedPin,
  savedViewportKey = "",
  allowEmptyMap = false,
  coordinateActionLabel,
  coordinateActionInFullscreenOnly = false,
}: {
  points: MapPoint[];
  path?: PathPoint[];
  showLegend?: boolean;
  onSelectCoordinate?: (point: { latitude: number; longitude: number }) => void;
  /** A temporary, non-editable position inside the waypoint confirmation. */
  selectionPreview?: boolean;
  savedPins?: SavedMapPin[];
  onSelectSavedPin?: (id: string) => void;
  savedViewportKey?: string;
  allowEmptyMap?: boolean;
  coordinateActionLabel?: string;
  coordinateActionInFullscreenOnly?: boolean;
}) {
  const titleId = useId();
  const surfaceRef = useRef<HTMLDialogElement>(null);
  const expandRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef(false);
  const [fullscreen, setFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<InstanceType<KakaoMapsNamespace["Map"]> | null>(null);
  const overlayCleanupFailedRef = useRef(false);
  const selectRef = useRef(onSelectCoordinate);
  const savedSelectRef = useRef(onSelectSavedPin);
  useEffect(() => { savedSelectRef.current = onSelectSavedPin; }, [onSelectSavedPin]);
  const fittedSavedRef = useRef<string | null>(null);
  useEffect(() => { selectRef.current = onSelectCoordinate; }, [onSelectCoordinate]);
  const appKey = process.env.NEXT_PUBLIC_KAKAO_MAP_JS_KEY;
  const hasGeometry = allowEmptyMap || points.length > 0 || Boolean(path?.length);
  const savedKey = JSON.stringify(savedPins);
  const geometryKey = JSON.stringify({ points, path: path ?? [] });
  const [mapState, setMapState] = useState<{ status: "loading" | "ready" | "error"; geometryKey: string }>({
    status: "loading",
    geometryKey,
  });
  const state: MapDisplayState = !hasGeometry
    ? "empty"
    : appKey
      ? mapState.geometryKey === geometryKey ? mapState.status : "loading"
      : "demo";
  const isReady = state === "ready";
  const previewLatitude = selectionPreview ? points[0]?.latitude : undefined;
  const previewLongitude = selectionPreview ? points[0]?.longitude : undefined;

  function keepFocusInMap(event: KeyboardEvent<HTMLDialogElement>) {
    if (!fullscreen || event.key !== "Tab") return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
      "button, a[href], input, select, textarea, [tabindex]",
    )).filter(element => element.tabIndex >= 0 && !element.matches(":disabled")
      && !element.closest("[inert]") && element.getClientRects().length > 0);
    const first = controls[0]; const last = controls.at(-1);
    if (first && last && ((event.shiftKey && document.activeElement === first)
      || (!event.shiftKey && document.activeElement === last))) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || fullscreen === modalRef.current) return;
    // Keep the same map container in place when moving it into the top layer.
    // A modeless dialog must first close before it can become modal.
    surface.close();
    if (fullscreen) {
      surface.showModal();
      closeRef.current?.focus({ preventScroll: true });
    } else {
      surface.show();
      expandRef.current?.focus({ preventScroll: true });
    }
    modalRef.current = fullscreen;
  }, [fullscreen]);

  useEffect(() => {
    if (!isReady || !containerRef.current || !mapRef.current) return;
    const map = mapRef.current;
    const observer = new ResizeObserver(() => {
      try {
        // A read-only preview remains centered on the selected raw point even
        // when the SDK adjusts its camera during a viewport resize.
        const center = previewLatitude !== undefined && previewLongitude !== undefined && window.kakao?.maps
          ? new window.kakao.maps.LatLng(previewLatitude, previewLongitude) : map.getCenter();
        const level = map.getLevel();
        map.relayout();
        map.setLevel(level);
        map.setCenter(center);
      } catch {
        setMapState({ status: "error", geometryKey });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [isReady, geometryKey, previewLatitude, previewLongitude]);

  useEffect(() => {
    if (!isReady || !onSelectCoordinate || !containerRef.current || !mapRef.current) return;
    const map = mapRef.current;
    return bindMapLongPress(containerRef.current, (x, y) => {
      const maps = window.kakao?.maps;
      if (!maps || !selectRef.current) return;
      const point = map.getProjection().coordsFromContainerPoint(new maps.Point(x, y));
      selectRef.current({ latitude: point.getLat(), longitude: point.getLng() });
    });
  }, [isReady, geometryKey, onSelectCoordinate]);

  useEffect(() => {
    if (!hasGeometry || !appKey) return;
    const geometry = JSON.parse(geometryKey) as { points: MapPoint[]; path: PathPoint[] };

    let active = true;
    let script: HTMLScriptElement | null = null;
    let onLoad: (() => void) | null = null;
    let onError: (() => void) | null = null;
    const overlays: Array<{ setMap(map: null): void }> = [];
    const timeout = window.setTimeout(() => {
      if (active) {
        if (script && script.dataset.motocastKakaoMapStatus === "loading" && !window.kakao?.maps) script.dataset.motocastKakaoMapStatus = "error";
        setMapState({ status: "error", geometryKey });
      }
    }, KAKAO_MAP_LOAD_TIMEOUT_MS);

    const clearOverlays = () => {
      for (const overlay of overlays.splice(0)) {
        try {
          overlay.setMap(null);
        } catch {
          overlayCleanupFailedRef.current = true;
          console.error("지도 표시 요소를 정리하지 못했습니다.");
        }
      }
    };

    const fail = () => {
      if (!active) return;
      window.clearTimeout(timeout);
      clearOverlays();
      setMapState({ status: "error", geometryKey });
    };

    const renderMap = () => {
      if (!containerRef.current) return;
      if (overlayCleanupFailedRef.current) {
        fail();
        return;
      }
      const maps = window.kakao?.maps;
      if (!maps) {
        fail();
        return;
      }
      if (typeof maps.load !== "function") {
        fail();
        return;
      }
      try {
        maps.load(() => {
          if (!active || !containerRef.current) return;
          const loadedMaps = window.kakao?.maps;
          if (!loadedMaps) {
            fail();
            return;
          }
          try {
            const groupedMarkers = markerGroups(geometry.points);
            const markerPath = groupedMarkers.map((group) => new loadedMaps.LatLng(group.latitude, group.longitude));
            const routePath = geometry.path.map((point) => new loadedMaps.LatLng(point.latitude, point.longitude));
            const map = mapRef.current ?? new loadedMaps.Map(containerRef.current, { center: markerPath[0] ?? routePath[0] ?? new loadedMaps.LatLng(37.5665, 126.978), level: 8 });
            mapRef.current = map;
            const bounds = new loadedMaps.LatLngBounds();
            routePath.forEach((position) => bounds.extend(position));
            markerPath.forEach((position, index) => {
              bounds.extend(position);
              const group = groupedMarkers[index];
              overlays.push(new loadedMaps.Marker({
                map,
                position,
                title: selectionPreview ? "선택한 위치" : group.points.map((point) => `${markerAppearance[point.role ?? "waypoint"].label} · ${point.label}`).join(" / "),
                image: markerImage(loadedMaps, group.points, selectionPreview),
              }));
            });
            if (routePath.length) {
              overlays.push(new loadedMaps.Polyline({
                map, path: routePath, strokeWeight: 9,
                strokeColor: designTokens["text-primary"], strokeOpacity: 1, strokeStyle: "solid",
              }));
              overlays.push(new loadedMaps.Polyline({
                map,
                path: routePath,
                strokeWeight: 4.5,
                strokeColor: designTokens["signal-fill"],
                strokeOpacity: 1,
                strokeStyle: "solid",
              }));
            }
            if (selectionPreview && markerPath[0]) {
              map.setCenter(markerPath[0]);
              map.setLevel(4);
            } else if (markerPath.length || routePath.length) map.setBounds(bounds);
            window.clearTimeout(timeout);
            setMapState({ status: "ready", geometryKey });
          } catch {
            fail();
          }
        });
      } catch {
        fail();
      }
    };

    if (window.kakao?.maps) {
      renderMap();
    } else {
      try {
        script = document.querySelector<HTMLScriptElement>("script[data-motocast-kakao-map]");
        if (!script) {
          script = document.createElement("script");
          script.dataset.motocastKakaoMap = "true";
          script.dataset.motocastKakaoMapStatus = "loading";
          script.async = true;
          script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false`;
          document.head.appendChild(script);
        }

        onLoad = () => {
          if (!script) return;
          if (!window.kakao?.maps) {
            script.dataset.motocastKakaoMapStatus = "error";
            fail();
            return;
          }
          script.dataset.motocastKakaoMapStatus = "ready";
          renderMap();
        };
        onError = () => {
          if (script) script.dataset.motocastKakaoMapStatus = "error";
          fail();
        };

        if (script.dataset.motocastKakaoMapStatus === "ready") onLoad();
        else if (script.dataset.motocastKakaoMapStatus === "error") onError();
        else {
          script.addEventListener("load", onLoad, { once: true });
          script.addEventListener("error", onError, { once: true });
        }
      } catch {
        fail();
      }
    }

    return () => {
      active = false;
      window.clearTimeout(timeout);
      if (script && onLoad) script.removeEventListener("load", onLoad);
      if (script && onError) script.removeEventListener("error", onError);
      clearOverlays();
    };
  }, [appKey, geometryKey, hasGeometry, selectionPreview]);

  useEffect(() => {
    if (!isReady) return;
    const maps = window.kakao?.maps;
    const map = mapRef.current;
    if (!isReady || !maps || !map) return;
    const pins = JSON.parse(savedKey) as SavedMapPin[];
    let active = true;
    const owned: Array<{ marker: { setMap(map: unknown): void }; select: () => void }> = [];
    try {
      if (overlayCleanupFailedRef.current) throw new Error("OVERLAY_CLEANUP_FAILED");
      const bounds = new maps.LatLngBounds();
      for (const pin of pins) {
        const position = new maps.LatLng(pin.latitude, pin.longitude);
        bounds.extend(position);
        const restaurant = pin.kind === "restaurant";
        const symbol = restaurant ? "식" : "S";
        const color = designTokens["text-primary"];
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="48"><rect x="2" y="2" width="36" height="38" rx="${restaurant ? 8 : 18}" fill="${color}" stroke="${designTokens["surface-card"]}" stroke-width="2"/><path d="M14 39L20 47L26 39" fill="${color}"/><text x="20" y="27" text-anchor="middle" font-family="sans-serif" font-size="14" fill="${designTokens["surface-card"]}">${symbol}</text></svg>`;
        const marker = new maps.Marker({ map, position, title: `${restaurant ? "식당" : "라이딩 스팟"} · ${pin.label}`, image: new maps.MarkerImage(`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`, new maps.Size(40, 48), { offset: new maps.Point(20, 47) }) });
        const select = () => { if (active && !overlayCleanupFailedRef.current) savedSelectRef.current?.(pin.id); };
        owned.push({ marker, select });
        maps.event.addListener(marker, "click", select);
      }
      // Explicit region selection may adjust the camera; toggles and aliases never do.
      if (pins.length && fittedSavedRef.current !== savedViewportKey) { map.setBounds(bounds); fittedSavedRef.current = savedViewportKey; }
    } catch { queueMicrotask(() => { if (active) setMapState({ status: "error", geometryKey }); }); }
    return () => {
      active = false;
      for (const { marker, select } of owned) {
        for (const remove of [() => maps.event.removeListener(marker, "click", select), () => marker.setMap(null)]) {
          try { remove(); } catch { overlayCleanupFailedRef.current = true; console.error("저장 장소 핀을 정리하지 못했습니다."); }
        }
      }
      if (overlayCleanupFailedRef.current) setMapState({ status: "error", geometryKey });
    };
  }, [isReady, savedKey, savedViewportKey, geometryKey]);

  if (selectionPreview) return <div className="map-shell map-selection-preview" aria-label="선택한 위치 미리보기">
    <div ref={containerRef} className={`map-canvas ${isReady ? "is-ready" : ""}`} aria-hidden={!isReady} inert />
    <div className={`map-status ${isReady ? "is-visually-hidden" : ""}`} role="status">
      {isReady ? "선택한 위치가 지도에 표시되었습니다." : state === "loading" ? "선택한 위치의 지도를 불러오는 중" : "위치 지도를 불러오지 못했어요. 주소를 확인하거나 취소 후 다시 선택해 주세요."}
    </div>
  </div>;

  return (
    <div className="map-shell" aria-label="선택한 라이딩 경로 지도">
      <dialog ref={surfaceRef} open className={`map-surface${fullscreen ? " is-fullscreen" : ""}`}
        role={fullscreen ? "dialog" : "region"} aria-modal={fullscreen || undefined}
        aria-label={fullscreen ? undefined : "선택한 라이딩 경로 지도"} aria-labelledby={fullscreen ? titleId : undefined}
        onKeyDown={keepFocusInMap}
        onCancel={(event) => { event.preventDefault(); event.stopPropagation(); setFullscreen(false); }}>
        <header className="map-fullscreen-header" hidden={!fullscreen}>
          <h2 id={titleId}>경로 지도</h2>
          <button type="button" ref={closeRef} onClick={() => setFullscreen(false)}>닫기</button>
        </header>
        <div className="map-viewport">
          <div ref={containerRef} className={`map-canvas ${isReady ? "is-ready" : ""}`} aria-hidden={!isReady} inert={!isReady} />
          <MapStatus state={state} actualRoute={Boolean(path?.length)} savedPlaces={allowEmptyMap} />
          <button type="button" ref={expandRef} className="map-fullscreen-trigger" hidden={fullscreen} onClick={() => setFullscreen(true)}>전체화면</button>
          {isReady && showLegend ? <MapMarkerLegend points={points} /> : null}
          {!isReady && state !== "empty" && !allowEmptyMap ? <SchematicRoute state={state} points={points} actualRoute={Boolean(path?.length)} /> : null}
        </div>
        {isReady && onSelectCoordinate && (!coordinateActionInFullscreenOnly || fullscreen) ? <div className="map-waypoint-actions"><p>{coordinateActionLabel ? "지도를 길게 누르거나 중심 지점을 선택해 장소를 등록하세요." : fullscreen ? "확대·이동하거나 지도를 길게 눌러 경유지를 선택하세요." : "지도를 길게 눌러 경유지를 선택하세요. 확대·이동 후 중심 지점을 선택할 수도 있어요."}</p><button type="button" onClick={() => { const point = mapRef.current?.getCenter(); if (point) onSelectCoordinate({ latitude: point.getLat(), longitude: point.getLng() }); }}>{coordinateActionLabel ?? "지도 중심에서 경유지 선택"}</button></div>
          : fullscreen && isReady ? <div className="map-viewing-hint"><p>확대·이동하며 경로를 확인하세요.</p></div> : null}
      </dialog>
    </div>
  );
}

export function MapMarkerLegend({ points, inline = false }: { points: MapPoint[]; inline?: boolean }) {
  const roles = Array.from(new Set(points.map((point) => point.role ?? "waypoint")));
  return (
    <ul className={`map-marker-legend${inline ? " is-inline" : ""}`} aria-label="지도 지점 표시 안내">
      {roles.map((role) => (
        <li key={role}>
          <span className="map-marker-symbol" style={{ backgroundColor: markerAppearance[role].color }} aria-hidden="true">
            {markerAppearance[role].symbol}
          </span>
          {markerAppearance[role].label}
        </li>
      ))}
    </ul>
  );
}

export function MapOmissionList({ points }: { points: MapPoint[] }) {
  const omittedPoints = points.filter((point) => point.nonTraversed);
  if (!omittedPoints.length) return null;

  return (
    <section className="map-omissions" aria-labelledby="map-omissions-heading">
      <div>
        <p className="eyebrow">ROUTE NOTICE</p>
        <h2 id="map-omissions-heading">선택 경로에서 지나지 않는 지점</h2>
      </div>
      <ul>
        {omittedPoints.map((point, index) => {
          const role = point.role ?? "waypoint";
          return (
            <li key={`${point.latitude}:${point.longitude}:${role}:${index}`}>
              <span className="map-marker-symbol is-omitted" style={{ backgroundColor: markerAppearance[role].color }} aria-hidden="true">
                {markerAppearance[role].symbol}<LineIcon name="close" />
              </span>
              <span>{markerAppearance[role].label} · {point.label}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SchematicRoute({ state, points, actualRoute }: { state: "loading" | "demo" | "error"; points: MapPoint[]; actualRoute: boolean }) {
  return (
    <div className="schematic-map">
      <div className="map-grid" aria-hidden="true" />
      {state === "demo" && !actualRoute ? <svg className="route-sketch" viewBox="0 0 720 430" role="img" aria-label="데모 경로 개요">
        <path className="map-water" d="M0 292 Q160 224 340 269 T720 248 L720 316 Q530 276 350 335 T0 351Z" />
        <path className="route-shadow" d="M62 332 C148 270 131 170 245 194 S365 90 455 129 S546 305 662 213" />
        <path className="route-line" d="M62 332 C148 270 131 170 245 194 S365 90 455 129 S546 305 662 213" />
        {["62,332", "245,194", "455,129", "662,213"].map((coordinates, index) => {
          const [cx, cy] = coordinates.split(",");
          return (
            <g key={coordinates}>
              <title>{points[index]?.label ?? `지점 ${index + 1}`}</title>
              <rect x={Number(cx) - 14} y={Number(cy) - 14} width="28" height="28" rx="5" className="route-chip" />
              <text x={cx} y={Number(cy) + 6} className="route-chip-text">{markerAppearance[points[index]?.role ?? "waypoint"].symbol}</text>
            </g>
          );
        })}
      </svg> : null}
    </div>
  );
}

function MapStatus({ state, actualRoute, savedPlaces = false }: { state: MapDisplayState; actualRoute: boolean; savedPlaces?: boolean }) {
  return (
    <div className={`map-status ${state === "ready" ? "is-visually-hidden" : ""}`} role="status" aria-live="polite">
      <span className={`status-dot ${state}`} />
      {state === "empty" ? "장소를 선택하면 지도에 표시해요" : null}
      {state === "loading" ? actualRoute ? "실제 경로 지도를 불러오는 중" : "카카오 지도를 불러오는 중" : null}
      {state === "ready" ? actualRoute ? "실제 경로 지도 준비 완료" : "카카오 지도 준비 완료" : null}
      {state === "demo" ? savedPlaces ? "지도 연결이 설정되지 않았어요. 저장 장소 목록은 확인할 수 있어요." : actualRoute ? "카카오 지도 키 미설정 · 실제 경로 선을 표시할 수 없습니다" : "카카오 지도 키 미설정 · 예시 경로 개요 표시 중" : null}
      {state === "error" ? actualRoute ? "카카오 지도 로드 실패 · 실제 경로 선을 표시할 수 없습니다" : "카카오 지도 로드 실패 · 설정 확인 후 새로고침해 주세요" : null}
    </div>
  );
}
