"use client";

import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { designTokens } from "@/packages/shared-ui/src/design-tokens";
import { LineIcon } from "@/components/line-icon";
import { CENTER_TARGET, clusterPinImage, numberedPinImage, savedPinImage, type PinImage } from "@/components/map-pin-images";
import { bindMapLongPress } from "@/lib/places/map-long-press";
import {
  CLUSTER_FIT_PADDING,
  CLUSTER_RECALCULATE_DELAY_MS,
  clusterPins,
  clusterZoomLevel,
  MIN_MAP_LEVEL,
} from "@/lib/places/clustering";

export type MapMarkerRole = "origin" | "destination" | "meal" | "lunch" | "dinner" | "rest" | "waypoint";
export type MapPoint = { label: string; latitude: number; longitude: number; role?: MapMarkerRole; nonTraversed?: boolean };
type PathPoint = { latitude: number; longitude: number };
export type SavedMapPin = PathPoint & { id: string; label: string; kind: "riding_spot" | "restaurant"; starred?: boolean };
/** Registration search result pin; never clustered. */
export type NumberedMapPin = PathPoint & { id: string; number: number; label: string };
export type MapCenterHandle = { getCenter(): PathPoint | null };
const MAX_MAP_LEVEL = 14;
const markerImageFrom = (maps: KakaoMapsNamespace, image: PinImage) =>
  new maps.MarkerImage(`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(image.svg)}`, new maps.Size(image.width, image.height), { offset: new maps.Point(image.offsetX, image.offsetY) });
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
    // The same v2/Map/CenterTarget the picker shows; its tip is the selected point.
    return new maps.MarkerImage(CENTER_TARGET.src, new maps.Size(CENTER_TARGET.width, CENTER_TARGET.height), { offset: new maps.Point(CENTER_TARGET.offsetX, CENTER_TARGET.offsetY) });
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
  selectedSavedPinId = null,
  onSelectSavedCluster,
  numberedPins = [],
  selectedNumberedPinId = null,
  onSelectNumberedPin,
  centerPicker = false,
  centerLocked = false,
  centerHandle,
  initialView,
  allowFullscreen = true,
  markerPoint = null,
  onClustersChange,
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
  /** Drawn as the larger yellow pin and never clustered. */
  selectedSavedPinId?: string | null;
  /** Called for a cluster whose pins share one coordinate (zooming cannot split it). */
  onSelectSavedCluster?: (ids: string[]) => void;
  numberedPins?: NumberedMapPin[];
  selectedNumberedPinId?: string | null;
  onSelectNumberedPin?: (id: string) => void;
  /** Fixed center marker with zoom buttons; read the point through `centerHandle`. */
  centerPicker?: boolean;
  /** Keeps the picked point under the target while its address is checked. */
  centerLocked?: boolean;
  centerHandle?: Ref<MapCenterHandle>;
  initialView?: PathPoint & { level: number };
  /** Small maps in details and registration have no fullscreen control (FP02, FP12). */
  allowFullscreen?: boolean;
  /** A long-pressed point shown with the center target while its sheet is open (FP28). */
  markerPoint?: PathPoint | null;
  /** Whether any saved-pin cluster is drawn, for the cluster hint under the map (FP30). */
  onClustersChange?: (visible: boolean) => void;
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
  const savedClusterRef = useRef(onSelectSavedCluster);
  useEffect(() => { savedClusterRef.current = onSelectSavedCluster; }, [onSelectSavedCluster]);
  const clustersRef = useRef(onClustersChange);
  useEffect(() => { clustersRef.current = onClustersChange; }, [onClustersChange]);
  const numberedSelectRef = useRef(onSelectNumberedPin);
  useEffect(() => { numberedSelectRef.current = onSelectNumberedPin; }, [onSelectNumberedPin]);
  const fittedNumberedRef = useRef<string | null>(null);
  const centeredNumberedRef = useRef<string | null>(null);
  useImperativeHandle(centerHandle, () => ({
    getCenter() {
      const center = mapRef.current?.getCenter();
      return center ? { latitude: center.getLat(), longitude: center.getLng() } : null;
    },
  }), []);
  const fittedSavedRef = useRef<string | null>(null);
  useEffect(() => { selectRef.current = onSelectCoordinate; }, [onSelectCoordinate]);
  const appKey = process.env.NEXT_PUBLIC_KAKAO_MAP_JS_KEY;
  const hasGeometry = allowEmptyMap || points.length > 0 || Boolean(path?.length);
  const savedKey = JSON.stringify(savedPins);
  const numberedKey = JSON.stringify(numberedPins);
  const initialViewKey = JSON.stringify(initialView ?? null);
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
    const startView = JSON.parse(initialViewKey) as (PathPoint & { level: number }) | null;

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
            const map = mapRef.current ?? new loadedMaps.Map(containerRef.current, {
              center: markerPath[0] ?? routePath[0] ?? (startView ? new loadedMaps.LatLng(startView.latitude, startView.longitude) : new loadedMaps.LatLng(37.5665, 126.978)),
              level: startView?.level ?? 8,
            });
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
    // The start view only seeds a new map; an existing map keeps its camera.
  }, [appKey, geometryKey, hasGeometry, selectionPreview, initialViewKey]);

  useEffect(() => {
    if (!isReady) return;
    const maps = window.kakao?.maps;
    const map = mapRef.current;
    if (!isReady || !maps || !map) return;
    const pins = JSON.parse(savedKey) as SavedMapPin[];
    const byId = new Map(pins.map((pin) => [pin.id, pin]));
    let active = true;
    let timer: number | undefined;
    let idleBound = false;
    const owned: Array<{ marker: { setMap(map: unknown): void }; select: () => void }> = [];
    const detach = () => {
      for (const { marker, select } of owned.splice(0)) {
        for (const remove of [() => maps.event.removeListener(marker, "click", select), () => marker.setMap(null)]) {
          try { remove(); } catch { overlayCleanupFailedRef.current = true; console.error("저장 장소 핀을 정리하지 못했습니다."); }
        }
      }
    };
    const fail = () => queueMicrotask(() => { if (active) setMapState({ status: "error", geometryKey }); });
    const openCluster = (ids: string[], sameCoordinates: boolean, latitude: number, longitude: number) => {
      if (!active || overlayCleanupFailedRef.current) return;
      const anchor = new maps.LatLng(latitude, longitude);
      if (sameCoordinates) {
        // Zooming never separates pins on one coordinate, so list them instead.
        if (savedClusterRef.current) savedClusterRef.current(ids);
        else map.setLevel(MIN_MAP_LEVEL, { anchor });
        return;
      }
      const level = map.getLevel();
      const bounds = new maps.LatLngBounds();
      for (const id of ids) {
        const pin = byId.get(id);
        if (pin) bounds.extend(new maps.LatLng(pin.latitude, pin.longitude));
      }
      map.setBounds(bounds, CLUSTER_FIT_PADDING, CLUSTER_FIT_PADDING, CLUSTER_FIT_PADDING, CLUSTER_FIT_PADDING);
      const target = clusterZoomLevel(level, map.getLevel());
      if (map.getLevel() !== target) map.setLevel(target, { anchor });
    };
    const render = () => {
      detach();
      if (overlayCleanupFailedRef.current) throw new Error("OVERLAY_CLEANUP_FAILED");
      const projection = map.getProjection();
      const inputs = pins.map((pin) => {
        const point = projection.containerPointFromCoords(new maps.LatLng(pin.latitude, pin.longitude));
        return { id: pin.id, x: point.x, y: point.y, latitude: pin.latitude, longitude: pin.longitude, starred: Boolean(pin.starred) };
      });
      const selected = selectedSavedPinId && byId.has(selectedSavedPinId) ? new Set([selectedSavedPinId]) : undefined;
      const groups = clusterPins(inputs, map.getLevel(), selected);
      clustersRef.current?.(groups.some((group) => group.kind === "cluster"));
      for (const group of groups) {
        let marker: { setMap(map: unknown): void };
        let select: () => void;
        if (group.kind === "pin") {
          const pin = byId.get(group.pin.id)!;
          const isSelected = pin.id === selectedSavedPinId;
          marker = new maps.Marker({
            map,
            position: new maps.LatLng(pin.latitude, pin.longitude),
            title: `${pin.kind === "restaurant" ? "식당" : "라이딩 스팟"} · ${pin.label}${pin.starred ? " · 자주 찾는 장소" : ""}`,
            image: markerImageFrom(maps, savedPinImage({ kind: pin.kind, starred: Boolean(pin.starred), selected: isSelected })),
            zIndex: isSelected ? 3 : 1,
          });
          select = () => { if (active && !overlayCleanupFailedRef.current) savedSelectRef.current?.(pin.id); };
        } else {
          marker = new maps.Marker({
            map,
            position: new maps.LatLng(group.latitude, group.longitude),
            title: `저장 장소 ${group.count}곳 묶음${group.starred ? " · 자주 찾는 장소 포함" : ""}`,
            image: markerImageFrom(maps, clusterPinImage(group)),
            zIndex: 2,
          });
          select = () => openCluster(group.ids, group.sameCoordinates, group.latitude, group.longitude);
        }
        owned.push({ marker, select });
        maps.event.addListener(marker, "click", select);
      }
    };
    // Recalculate only after the camera settles; positions come from pins already loaded.
    const onIdle = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!active) return;
        try { render(); } catch { fail(); }
      }, CLUSTER_RECALCULATE_DELAY_MS);
    };
    try {
      // Explicit region selection may adjust the camera; toggles and aliases never do.
      if (pins.length && fittedSavedRef.current !== savedViewportKey) {
        const bounds = new maps.LatLngBounds();
        for (const pin of pins) bounds.extend(new maps.LatLng(pin.latitude, pin.longitude));
        map.setBounds(bounds);
        fittedSavedRef.current = savedViewportKey;
      }
      render();
      if (pins.length) { maps.event.addListener(map, "idle", onIdle); idleBound = true; }
    } catch { fail(); }
    return () => {
      active = false;
      window.clearTimeout(timer);
      detach();
      if (idleBound) {
        try { maps.event.removeListener(map, "idle", onIdle); } catch { overlayCleanupFailedRef.current = true; console.error("저장 장소 핀을 정리하지 못했습니다."); }
      }
      if (overlayCleanupFailedRef.current) setMapState({ status: "error", geometryKey });
    };
  }, [isReady, savedKey, savedViewportKey, geometryKey, selectedSavedPinId]);

  useEffect(() => {
    if (!isReady) return;
    const maps = window.kakao?.maps;
    const map = mapRef.current;
    if (!maps || !map) return;
    const pins = JSON.parse(numberedKey) as NumberedMapPin[];
    if (!pins.length) return;
    let active = true;
    const owned: Array<{ marker: { setMap(map: unknown): void }; select: () => void }> = [];
    try {
      if (overlayCleanupFailedRef.current) throw new Error("OVERLAY_CLEANUP_FAILED");
      for (const pin of pins) {
        const isSelected = pin.id === selectedNumberedPinId;
        const marker = new maps.Marker({
          map,
          position: new maps.LatLng(pin.latitude, pin.longitude),
          title: `${pin.number}번 · ${pin.label}`,
          image: markerImageFrom(maps, numberedPinImage({ number: pin.number, selected: isSelected })),
          zIndex: isSelected ? 3 : 1,
        });
        const select = () => { if (active && !overlayCleanupFailedRef.current) numberedSelectRef.current?.(pin.id); };
        owned.push({ marker, select });
        maps.event.addListener(marker, "click", select);
      }
      // A new result set is fitted once; a later selection only recenters on that result.
      if (fittedNumberedRef.current !== numberedKey) {
        const bounds = new maps.LatLngBounds();
        for (const pin of pins) bounds.extend(new maps.LatLng(pin.latitude, pin.longitude));
        map.setBounds(bounds, CLUSTER_FIT_PADDING, CLUSTER_FIT_PADDING, CLUSTER_FIT_PADDING, CLUSTER_FIT_PADDING);
        fittedNumberedRef.current = numberedKey;
        centeredNumberedRef.current = selectedNumberedPinId;
      } else if (centeredNumberedRef.current !== selectedNumberedPinId) {
        const selected = pins.find((pin) => pin.id === selectedNumberedPinId);
        if (selected) map.setCenter(new maps.LatLng(selected.latitude, selected.longitude));
        centeredNumberedRef.current = selectedNumberedPinId;
      }
    } catch { queueMicrotask(() => { if (active) setMapState({ status: "error", geometryKey }); }); }
    return () => {
      active = false;
      for (const { marker, select } of owned) {
        for (const remove of [() => maps.event.removeListener(marker, "click", select), () => marker.setMap(null)]) {
          try { remove(); } catch { overlayCleanupFailedRef.current = true; console.error("검색 결과 핀을 정리하지 못했습니다."); }
        }
      }
      if (overlayCleanupFailedRef.current) setMapState({ status: "error", geometryKey });
    };
  }, [isReady, numberedKey, selectedNumberedPinId, geometryKey]);

  useEffect(() => {
    if (!isReady || !centerPicker || !mapRef.current) return;
    try {
      mapRef.current.setDraggable(!centerLocked);
    } catch {
      queueMicrotask(() => setMapState({ status: "error", geometryKey }));
    }
  }, [isReady, centerPicker, centerLocked, geometryKey]);

  const markerKey = markerPoint ? `${markerPoint.latitude}:${markerPoint.longitude}` : "";
  useEffect(() => {
    if (!isReady || !markerKey) return;
    const maps = window.kakao?.maps;
    const map = mapRef.current;
    if (!maps || !map) return;
    const [latitude, longitude] = markerKey.split(":").map(Number);
    let marker: { setMap(map: unknown): void } | null = null;
    try {
      marker = new maps.Marker({
        map,
        position: new maps.LatLng(latitude, longitude),
        title: "선택한 위치",
        image: new maps.MarkerImage(CENTER_TARGET.src, new maps.Size(CENTER_TARGET.width, CENTER_TARGET.height), { offset: new maps.Point(CENTER_TARGET.offsetX, CENTER_TARGET.offsetY) }),
        zIndex: 4,
      });
    } catch { queueMicrotask(() => setMapState({ status: "error", geometryKey })); }
    return () => {
      try { marker?.setMap(null); } catch { overlayCleanupFailedRef.current = true; console.error("선택한 위치 표시를 정리하지 못했습니다."); }
    };
  }, [isReady, markerKey, geometryKey]);

  function zoom(step: 1 | -1) {
    const map = mapRef.current;
    if (!map) return;
    try {
      map.setLevel(Math.min(MAX_MAP_LEVEL, Math.max(MIN_MAP_LEVEL, map.getLevel() + step)));
    } catch {
      setMapState({ status: "error", geometryKey });
    }
  }

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
          <button type="button" ref={expandRef} className="map-fullscreen-trigger" hidden={fullscreen || centerPicker || !allowFullscreen} onClick={() => setFullscreen(true)}>전체화면</button>
          {centerPicker && isReady ? <>
            <span className="map-center-marker" aria-hidden="true" />
            <div className="map-zoom-controls">
              <button type="button" aria-label="지도 확대" onClick={() => zoom(-1)}><span aria-hidden="true">+</span></button>
              <button type="button" aria-label="지도 축소" onClick={() => zoom(1)}><span aria-hidden="true">−</span></button>
            </div>
          </> : null}
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
