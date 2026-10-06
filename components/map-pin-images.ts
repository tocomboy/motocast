import { designTokens } from "@/packages/shared-ui/src/design-tokens";

/** SVG marker images for saved-place pins, clusters and numbered search results
 * (Figma 374:11242). Every image keeps at least a 48×48 hit area around the drawing. */
export type PinImage = { svg: string; width: number; height: number; offsetX: number; offsetY: number };

const ink = designTokens["text-primary"];
const card = designTokens["surface-card"];
const signal = designTokens["signal-fill"];
const star = designTokens["star-fill"];
const STAR_PATH = "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z";
const text = (x: number, y: number, size: number, fill: string, value: string) =>
  `<text x="${x}" y="${y}" text-anchor="middle" font-family="sans-serif" font-size="${size}" font-weight="700" fill="${fill}">${value}</text>`;
/** 12px yellow star with the 1.5 ink outline, its box's top-left at (x, y). */
const starBadge = (x: number, y: number) =>
  `<path d="${STAR_PATH}" transform="translate(${x - 1} ${y - 1}) scale(0.5833)" fill="${star}" stroke="${ink}" stroke-width="2.57" stroke-linejoin="round"/>`;

/** Default 28×34 (body 28, tail 6) or selected 36×44 (signal fill, 2px ink border). */
export function savedPinImage({ kind, starred, selected }: { kind: "riding_spot" | "restaurant"; starred: boolean; selected: boolean }): PinImage {
  const symbol = kind === "restaurant" ? "식" : "S";
  if (selected) {
    const body = kind === "restaurant"
      ? `<rect x="8" y="6" width="36" height="36" rx="8" fill="${signal}" stroke="${ink}" stroke-width="2"/>`
      : `<circle cx="26" cy="24" r="17" fill="${signal}" stroke="${ink}" stroke-width="2"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" viewBox="0 0 52 52"><path d="M20 40L26 50L32 40Z" fill="${ink}"/>${body}${text(26, 30, 16, ink, symbol)}${starred ? starBadge(38, 0) : ""}</svg>`;
    return { svg, width: 52, height: 52, offsetX: 26, offsetY: 50 };
  }
  const body = kind === "restaurant"
    ? `<rect x="10" y="10" width="28" height="28" rx="6" fill="${ink}" stroke="${card}" stroke-width="1.5"/>`
    : `<circle cx="24" cy="24" r="14" fill="${ink}" stroke="${card}" stroke-width="1.5"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><path d="M20 37L24 44L28 37Z" fill="${ink}"/>${body}${text(24, 28.5, 13, card, symbol)}${starred ? starBadge(33, 4) : ""}</svg>`;
  return { svg, width: 48, height: 48, offsetX: 24, offsetY: 44 };
}

/** Cluster S44 / M50 / L56 centered on the cluster position. */
export function clusterPinImage({ size, label, starred }: { size: 44 | 50 | 56; label: string; starred: boolean }): PinImage {
  const box = size + 8;
  const c = box / 2;
  const fontSize = size === 44 ? 14 : size === 50 ? 15 : 16;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}"><circle cx="${c}" cy="${c}" r="${size / 2}" fill="${ink}" fill-opacity="0.2"/><circle cx="${c}" cy="${c}" r="${size / 2 - 5}" fill="${ink}" stroke="${card}" stroke-width="2"/>${text(c, c + fontSize / 3, fontSize, card, label)}${starred ? starBadge(box - 14, 2) : ""}</svg>`;
  return { svg, width: box, height: box, offsetX: c, offsetY: c };
}

/** Numbered registration search result; the selected one is larger and yellow. */
export function numberedPinImage({ number, selected }: { number: number; selected: boolean }): PinImage {
  if (selected) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="52" height="52" viewBox="0 0 52 52"><path d="M20 40L26 50L32 40Z" fill="${ink}"/><circle cx="26" cy="24" r="17" fill="${signal}" stroke="${ink}" stroke-width="2"/>${text(26, 30, 16, ink, String(number))}</svg>`;
    return { svg, width: 52, height: 52, offsetX: 26, offsetY: 50 };
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><path d="M20 35L24 42L28 35Z" fill="${ink}"/><circle cx="24" cy="22" r="13" fill="${card}" stroke="${ink}" stroke-width="2"/>${text(24, 27, 14, ink, String(number))}</svg>`;
  return { svg, width: 48, height: 48, offsetX: 24, offsetY: 42 };
}
