import { designTokens } from "@/packages/shared-ui/src/design-tokens";

/** SVG marker images drawn from the Figma components v2/MapPin (367:11027),
 * v2/MapCluster (367:11061) and v2/SearchResultPin (367:11070). The drawing keeps the
 * component geometry; transparent padding gives every marker a 48×48 hit area. */
export type PinImage = { svg: string; width: number; height: number; offsetX: number; offsetY: number };

const ink = designTokens["text-primary"];
const card = designTokens["surface-card"];
const signal = designTokens["signal-fill"];
const star = designTokens["star-fill"];
// SVG markers are images, so page web fonts do not apply; these stacks are the closest fallbacks.
const SANS = "'Noto Sans KR', sans-serif";
const NUMBER = "'Barlow Semi Condensed', 'Arial Narrow', sans-serif";
const svgText = (x: number, y: number, size: number, fill: string, value: string, family = SANS) =>
  `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-family="${family}" font-size="${size}" font-weight="700" fill="${fill}">${value}</text>`;
/** v2/Icon/star-filled badge in its 16×16 box, top-left at (x, y). */
const starBadge = (x: number, y: number) =>
  `<path transform="translate(${x + 1.6} ${y + 1.5})" d="M6.36668 0.5L8.16668 4.23333L12.2333 4.83333L9.30001 7.7L9.96668 11.7667L6.36668 9.83333L2.76668 11.7667L3.43335 7.7L0.500014 4.83333L4.56668 4.23333L6.36668 0.5Z" fill="${star}" stroke="${ink}" stroke-linecap="round" stroke-linejoin="round"/>`;
const wrap = (width: number, height: number, dx: number, dy: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g transform="translate(${dx} ${dy})">${body}</g></svg>`;

/** Default 36×38 drawing (body 28, tail 10×6) or selected 44×48 (body 36, tail 12×8). */
export function savedPinImage({ kind, starred, selected }: { kind: "riding_spot" | "restaurant"; starred: boolean; selected: boolean }): PinImage {
  const symbol = kind === "restaurant" ? "식" : "S";
  if (selected) {
    const body = kind === "restaurant"
      ? `<rect x="3" y="7" width="34" height="34" rx="8" fill="${signal}" stroke="${ink}" stroke-width="2"/>`
      : `<circle cx="20" cy="24" r="17" fill="${signal}" stroke="${ink}" stroke-width="2"/>`;
    const drawing = `<path d="M14 40H26L20 48Z" fill="${ink}"/>${body}${svgText(20, 24, 15, ink, symbol)}${starred ? starBadge(28, 0) : ""}`;
    return { svg: wrap(52, 56, 6, 4, drawing), width: 52, height: 56, offsetX: 26, offsetY: 52 };
  }
  const body = kind === "restaurant"
    ? `<rect x="3" y="7" width="26" height="26" rx="6" fill="${ink}" stroke="${card}" stroke-width="2"/>`
    : `<circle cx="16" cy="20" r="13" fill="${ink}" stroke="${card}" stroke-width="2"/>`;
  const drawing = `<path d="M11 32H21L16 38Z" fill="${ink}"/>${body}${svgText(16, 20, 13, card, symbol)}${starred ? starBadge(20, 0) : ""}`;
  return { svg: wrap(48, 48, 8, 5, drawing), width: 48, height: 48, offsetX: 24, offsetY: 43 };
}

/** v2/MapPin state=avoided (367:10979, 367:11014): white body, dashed muted border and a slash. */
export function avoidedPinImage({ kind, starred }: { kind: "riding_spot" | "restaurant"; starred: boolean }): PinImage {
  const muted = designTokens["text-secondary"];
  const body = kind === "restaurant"
    ? `<rect x="3" y="7" width="26" height="26" rx="6" fill="${card}" stroke="${muted}" stroke-width="2" stroke-dasharray="3 2"/>`
    : `<circle cx="16" cy="20" r="13" fill="${card}" stroke="${muted}" stroke-width="2" stroke-dasharray="3 2"/>`;
  const drawing = `<path d="M11 32H21L16 38Z" fill="${muted}"/>${body}${svgText(16, 20, 13, muted, kind === "restaurant" ? "식" : "S")}<path d="M6 10L26 30" stroke="${muted}" stroke-width="2" stroke-linecap="round"/>${starred ? starBadge(20, 0) : ""}`;
  return { svg: wrap(48, 48, 8, 5, drawing), width: 48, height: 48, offsetX: 24, offsetY: 43 };
}

/** Cluster S44 / M50 / L56: 18% ink ring and an ink circle (32 / 38 / 44) centered on the cluster. */
export function clusterPinImage({ size, label, starred }: { size: 44 | 50 | 56; label: string; starred: boolean }): PinImage {
  const c = size / 2;
  const cy = c + 2;
  const inner = size - 12;
  const drawing = `<circle cx="${c}" cy="${cy}" r="${c - 2}" fill="${ink}" fill-opacity="0.18"/><circle cx="${c}" cy="${cy}" r="${inner / 2 - 1}" fill="${ink}" stroke="${card}" stroke-width="2"/>${svgText(c, cy, 15, card, label, NUMBER)}${starred ? starBadge(size - 18, 0) : ""}`;
  const box = size + 4;
  return { svg: wrap(box, box, 2, 2, drawing), width: box, height: box, offsetX: c + 2, offsetY: cy + 2 };
}

/** Numbered registration search result: white 28 circle, selected yellow 36. */
export function numberedPinImage({ number, selected }: { number: number; selected: boolean }): PinImage {
  if (selected) {
    const drawing = `<path d="M14 34H26L20 42Z" fill="${ink}"/><circle cx="20" cy="18" r="17" fill="${signal}" stroke="${ink}" stroke-width="2"/>${svgText(20, 18, 18, ink, String(number), NUMBER)}`;
    return { svg: wrap(52, 52, 6, 4, drawing), width: 52, height: 52, offsetX: 26, offsetY: 46 };
  }
  const drawing = `<path d="M11 26H21L16 34Z" fill="${ink}"/><circle cx="16" cy="14" r="13" fill="${card}" stroke="${ink}" stroke-width="2"/>${svgText(16, 14, 15, ink, String(number), NUMBER)}`;
  return { svg: wrap(48, 48, 8, 6, drawing), width: 48, height: 48, offsetX: 24, offsetY: 40 };
}

/** v2/Map/CenterTarget (367:11071), served from /map/center-target.svg; its tip is the point. */
export const CENTER_TARGET = { src: "/map/center-target.svg", width: 41, height: 53, offsetX: 19, offsetY: 47 } as const;
