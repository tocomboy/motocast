"use client";

import { useEffect, useRef, useState } from "react";

type MapPoint = { label: string; latitude: number; longitude: number };

export function KakaoMapCanvas({ points }: { points: MapPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const appKey = process.env.NEXT_PUBLIC_KAKAO_MAP_JS_KEY;
  const [state, setState] = useState<"loading" | "ready" | "demo" | "error">(
    appKey ? "loading" : "demo",
  );

  useEffect(() => {
    if (!appKey) return;

    const renderMap = () => {
      if (!containerRef.current || !window.kakao?.maps) return;
      window.kakao.maps.load(() => {
        if (!containerRef.current || !window.kakao?.maps) return;
        const maps = window.kakao.maps;
        const path = points.map((point) => new maps.LatLng(point.latitude, point.longitude));
        const map = new maps.Map(containerRef.current, { center: path[0], level: 8 });
        const bounds = new maps.LatLngBounds();
        path.forEach((position, index) => {
          bounds.extend(position);
          new maps.Marker({ map, position, title: points[index].label });
        });
        new maps.Polyline({
          map,
          path,
          strokeWeight: 5,
          strokeColor: "#ef6a3a",
          strokeOpacity: 0.9,
          strokeStyle: "solid",
        });
        map.setBounds(bounds);
        setState("ready");
      });
    };

    if (window.kakao?.maps) {
      renderMap();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>("script[data-motocast-kakao-map]");
    if (existing) {
      existing.addEventListener("load", renderMap, { once: true });
      return () => existing.removeEventListener("load", renderMap);
    }

    const script = document.createElement("script");
    script.dataset.motocastKakaoMap = "true";
    script.async = true;
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false`;
    script.addEventListener("load", renderMap, { once: true });
    script.addEventListener("error", () => setState("error"), { once: true });
    document.head.appendChild(script);
    return () => script.removeEventListener("load", renderMap);
  }, [appKey, points]);

  return (
    <div className="map-shell" aria-label="선택한 라이딩 경로 지도">
      <div ref={containerRef} className={`map-canvas ${state === "ready" ? "is-ready" : ""}`} />
      {state !== "ready" ? <SchematicRoute state={state} points={points} /> : null}
    </div>
  );
}

function SchematicRoute({ state, points }: { state: "loading" | "demo" | "error"; points: MapPoint[] }) {
  return (
    <div className="schematic-map">
      <div className="map-grid" aria-hidden="true" />
      <svg className="route-sketch" viewBox="0 0 720 430" role="img" aria-label="데모 경로 개요">
        <path className="route-shadow" d="M62 332 C148 270 131 170 245 194 S365 90 455 129 S546 305 662 213" />
        <path className="route-line" d="M62 332 C148 270 131 170 245 194 S365 90 455 129 S546 305 662 213" />
        {["62,332", "245,194", "455,129", "662,213"].map((coordinates, index) => {
          const [cx, cy] = coordinates.split(",");
          return (
            <g key={coordinates}>
              <circle cx={cx} cy={cy} r="12" className={index === 0 ? "route-dot start" : "route-dot"} />
              <text x={Number(cx) + 17} y={Number(cy) - 14} className="route-label">
                {points[index]?.label ?? `지점 ${index + 1}`}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="map-status">
        <span className={`status-dot ${state}`} />
        {state === "loading" ? "카카오 지도를 불러오는 중" : null}
        {state === "demo" ? "카카오 지도 키 미설정 · 경로 개요 표시 중" : null}
        {state === "error" ? "카카오 지도 로드 실패 · 저장된 경로 개요 표시 중" : null}
      </div>
    </div>
  );
}
