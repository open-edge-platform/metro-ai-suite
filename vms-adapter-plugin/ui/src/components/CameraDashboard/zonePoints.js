// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * Zone points for the camera page's zone editor.
 *
 * A point is { x, y, corner }: x and y are the editable text of its two boxes
 * (fractions of the frame, 0-1), and corner ('tl' | 'tr' | 'br' | 'bl') is
 * where its boxes sit around the zone sketch. The corner is chosen from the
 * point's position when the zone is loaded, reset or a point is added — not
 * while typing, so the boxes never jump (and lose focus) mid-edit.
 */

export const MIN_ZONE_POINTS = 3;
export const CORNERS = ['tl', 'tr', 'br', 'bl'];

/** True when a coordinate box holds a number from 0 to 1. */
export function isValidCoord(value) {
  if (String(value).trim() === '') return false;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 1;
}

export function isValidPoint(p) {
  return isValidCoord(p.x) && isValidCoord(p.y);
}

/** Corner with the fewest points, in tl, tr, br, bl order on ties. */
export function nextCorner(points) {
  const counts = Object.fromEntries(CORNERS.map((c) => [c, 0]));
  points.forEach((p) => { counts[p.corner] += 1; });
  return CORNERS.reduce((best, c) => (counts[c] < counts[best] ? c : best), CORNERS[0]);
}

/** Place each point at the sketch corner matching its side of the zone's centre. */
export function assignCorners(points) {
  const valid = points.filter(isValidPoint);
  const cx = valid.reduce((s, p) => s + Number(p.x), 0) / (valid.length || 1);
  const cy = valid.reduce((s, p) => s + Number(p.y), 0) / (valid.length || 1);
  const placed = [];
  points.forEach((p) => {
    if (!isValidPoint(p)) {
      placed.push({ ...p, corner: nextCorner(placed) });
      return;
    }
    const top = Number(p.y) <= cy;
    const left = Number(p.x) <= cx;
    placed.push({ ...p, corner: `${top ? 't' : 'b'}${left ? 'l' : 'r'}` });
  });
  return placed;
}

/** Parse a zone JSON string ([[x,y],...]) into editable, placed points. */
export function toZonePoints(text) {
  try {
    const raw = JSON.parse(text || '[]');
    if (!Array.isArray(raw)) return [];
    const points = raw
      .filter((p) => Array.isArray(p) && p.length === 2)
      .map(([x, y]) => ({
        x: String(Number(Number(x).toFixed(4))),
        y: String(Number(Number(y).toFixed(4))),
      }));
    return assignCorners(points);
  } catch {
    return [];
  }
}

/** Zone JSON as accepted by VAP's run start ([[x,y],...]). */
export function zoneToJson(points) {
  return JSON.stringify(points.map((p) => [Number(p.x), Number(p.y)]));
}

/** Mirrors VAP's server-side zone checks; returns an error message or null. */
export function validateZonePoints(points) {
  if (points.length === 0) return null; // no zone: VAP applies its configured default
  if (points.length < MIN_ZONE_POINTS) return `At least ${MIN_ZONE_POINTS} points are needed.`;
  return points.every(isValidPoint) ? null : 'Each X and Y must be a number from 0 to 1.';
}
