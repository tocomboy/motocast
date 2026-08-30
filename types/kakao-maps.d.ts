type KakaoLatLng = {
  getLat(): number;
  getLng(): number;
};

type KakaoMapsNamespace = {
  load(callback: () => void): void;
  LatLng: new (latitude: number, longitude: number) => KakaoLatLng;
  LatLngBounds: new () => { extend(point: KakaoLatLng): void };
  Map: new (
    container: HTMLElement,
    options: { center: KakaoLatLng; level: number },
  ) => { setBounds(bounds: { extend(point: KakaoLatLng): void }): void };
  Marker: new (options: { map: unknown; position: KakaoLatLng; title: string }) => unknown;
  Polyline: new (options: {
    map: unknown;
    path: KakaoLatLng[];
    strokeWeight: number;
    strokeColor: string;
    strokeOpacity: number;
    strokeStyle: string;
  }) => unknown;
};

interface Window {
  kakao?: { maps: KakaoMapsNamespace };
}
