// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";

/**
 * Floorplan JSON. The minimal form is the one from the brief:
 *   { "cameras": { "entry_cam_1": { "x": 120, "y": 450, "zone": "Lobby", "fov_angle": 90 } } }
 * Everything else is optional (see docs/user-guide/how-to-guides/configure-floorplan.md).
 * Coordinates are SVG user units, origin top-left, y pointing down.
 */
/** Plain JSON numbers only: "", null or true are mistakes, not 0. */
const num = z.number().finite();
const point = z.tuple([num, num]);

export const floorplanCameraSchema = z.looseObject({
  x: num,
  y: num,
  zone: z.string().optional(),
  /** Field-of-view width in degrees. */
  fov_angle: num.min(1).max(360).optional(),
  /** Viewing direction in degrees: 0 = right/east, 90 = down/south. */
  heading: num.optional(),
  /** FOV wedge length in plan units. */
  range: num.positive().optional(),
});

export const floorplanZoneSchema = z
  .object({
    name: z.string().min(1),
    points: z.array(point).min(3).optional(),
    rect: z
      .object({
        x: num,
        y: num,
        w: num.positive(),
        h: num.positive(),
      })
      .optional(),
    outdoor: z.boolean().optional(),
  })
  .refine((z) => !!z.points !== !!z.rect, {
    message: "a zone needs exactly one of points or rect",
  });

/** Only inline images or same-origin paths, so a plan never makes the browser call a foreign host. */
const background = z
  .string()
  .refine(
    (s) =>
      /^data:image\/(png|jpe?g|webp|svg\+xml)[;,]/i.test(s) ||
      (s.startsWith("/") && !s.startsWith("//")),
    "background must be a data:image URI or a same-origin path",
  );

export const floorplanSchema = z.object({
  name: z.string().optional(),
  canvas: z
    .object({
      width: num.positive(),
      height: num.positive(),
    })
    .optional(),
  background: background.optional(),
  zones: z.array(floorplanZoneSchema).optional(),
  walls: z.array(z.array(point).min(2)).optional(),
  cameras: z
    .record(z.string().min(1), floorplanCameraSchema)
    .refine((c) => Object.keys(c).length > 0, "cameras must not be empty"),
});

export type FloorplanCamera = z.infer<typeof floorplanCameraSchema>;
export type FloorplanZone = z.infer<typeof floorplanZoneSchema>;
export type Floorplan = z.infer<typeof floorplanSchema>;

export const MAX_FLOORPLAN_BYTES = 5 * 1024 * 1024;

export type ParseResult =
  { ok: true; plan: Floorplan } | { ok: false; error: string };

export function parseFloorplan(input: unknown): ParseResult {
  let data = input;
  if (typeof input === "string") {
    try {
      data = JSON.parse(input);
    } catch (e) {
      return { ok: false, error: `Not valid JSON: ${(e as Error).message}` };
    }
  }
  const res = floorplanSchema.safeParse(data);
  if (!res.success)
    return {
      ok: false,
      error: res.error.issues
        .slice(0, 4)
        .map((i) => `${i.path.join(".") || "plan"}: ${i.message}`)
        .join("; "),
    };
  return { ok: true, plan: res.data };
}
