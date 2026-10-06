type KakaoLatLng = {
  getLat(): number;
  getLng(): number;
};

type KakaoLatLngBounds = { extend(point: KakaoLatLng): void };

type KakaoMapsNamespace = {
  event: { addListener(target: unknown, event: string, callback: () => void): void; removeListener(target: unknown, event: string, callback: () => void): void };
  load(callback: () => void): void;
  LatLng: new (latitude: number, longitude: number) => KakaoLatLng;
  LatLngBounds: new () => KakaoLatLngBounds;
  Size: new (width: number, height: number) => unknown;
  Point: new (x: number, y: number) => unknown;
  MarkerImage: new (src: string, size: unknown, options?: { offset?: unknown }) => unknown;
  Map: new (
    container: HTMLElement,
    options: { center: KakaoLatLng; level: number },
  ) => {
    setBounds(bounds: KakaoLatLngBounds, paddingTop?: number, paddingRight?: number, paddingBottom?: number, paddingLeft?: number): void;
    getProjection(): {
      coordsFromContainerPoint(point: unknown): KakaoLatLng;
      containerPointFromCoords(point: KakaoLatLng): { x: number; y: number };
    };
    getCenter(): KakaoLatLng;
    setCenter(point: KakaoLatLng): void;
    getLevel(): number;
    setLevel(level: number, options?: { anchor?: KakaoLatLng }): void;
    relayout(): void;
  };
  Marker: new (options: { map: unknown; position: KakaoLatLng; title: string; image?: unknown; zIndex?: number }) => { setMap(map: unknown): void };
  Polyline: new (options: {
    map: unknown;
    path: KakaoLatLng[];
    strokeWeight: number;
    strokeColor: string;
    strokeOpacity: number;
    strokeStyle: string;
  }) => { setMap(map: unknown): void };
};

interface Window {
  kakao?: { maps: KakaoMapsNamespace };
}
