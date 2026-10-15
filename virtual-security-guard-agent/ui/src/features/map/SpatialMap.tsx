// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useId, useMemo, type Ref } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { formatClock } from "@/lib/time";
import type { TraceStop } from "@/stores/trace";
import {
  fovWedge,
  legArrows,
  planSize,
  routePath,
  zoneShapes,
} from "./geometry";
import type { KeyMap } from "./keymap";
import { layoutRoute } from "./route";
import type { Floorplan } from "./schema";
import { cameraName } from "@/stores/cameras";

export interface SpatialMapProps {
  plan: Floorplan;
  /** Floorplan camera key -> VSS tag. */
  keyMap: KeyMap;
  /** Ordered trace (see buildTrace). */
  stops?: TraceStop[];
  /** Tags to emphasise (e.g. the search scope). */
  highlightTags?: string[];
  /** Draw the route with Framer Motion. Off for PDF rasterisation. */
  animate?: boolean;
  /** Change to replay the route animation. */
  replayKey?: number;
  /** Which camera names to print. */
  labels?: "all" | "route" | "none";
  selectedKey?: string;
  onCameraClick?: (planKey: string) => void;
  svgRef?: Ref<SVGSVGElement>;
  className?: string;
  title?: string;
}

/**
 * Facility blueprint with camera nodes, fields of view and the subject's route.
 *
 * Coordinates come straight from the floorplan JSON (SVG user units, origin
 * top-left). Each camera key resolves to a VSS tag through `keyMap`; trace
 * stops are matched by tag, folded into visits and connected in order with a
 * glowing path whose `pathLength` Framer Motion animates from 0 to 1. Stop
 * markers and direction chevrons fade in as the line reaches them.
 */
export function SpatialMap({
  plan,
  keyMap,
  stops = [],
  highlightTags,
  animate = true,
  replayKey = 0,
  labels = "all",
  selectedKey,
  onCameraClick,
  svgRef,
  className,
  title,
}: SpatialMapProps) {
  const reduceMotion = useReducedMotion();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const size = useMemo(() => planSize(plan), [plan]);
  const zones = useMemo(() => zoneShapes(plan, size), [plan, size]);
  // Scale strokes and type with the plan so small and large canvases read the same.
  const u = Math.max(size.width, size.height) / 1000;
  const route = useMemo(
    () => layoutRoute(stops, plan, keyMap, 20 * u),
    [stops, plan, keyMap, u],
  );
  const routeKeys = new Set(route.visits.map((v) => v.planKey));
  const scope = new Set(highlightTags ?? []);
  const points = route.visits.map((v) => ({ x: v.x, y: v.y }));
  const d = routePath(points);
  const arrows = legArrows(points);
  const legs = Math.max(1, points.length - 1);
  const moving = animate && !reduceMotion;
  const duration = moving ? Math.min(6, 0.75 * legs + 0.3) : 0;
  const at = (i: number) =>
    moving ? (points.length > 1 ? (i / (points.length - 1)) * duration : 0) : 0;
  const grid = 25 * u;
  const font = 12 * u;

  const summary = route.visits.length
    ? `Route through ${route.visits.length} camera visits: ${route.visits
        .map((v) => `${v.index}. ${cameraName(v.tag)}`)
        .join(", ")}.`
    : `Floorplan with ${Object.keys(plan.cameras).length} cameras.`;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${size.width} ${size.height}`}
      className={cn("block h-auto w-full select-none", className)}
      role="img"
      aria-label={title ? `${title}. ${summary}` : summary}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <pattern
          id={`${uid}-minor`}
          width={grid}
          height={grid}
          patternUnits="userSpaceOnUse"
        >
          <path
            d={`M${grid} 0 L0 0 0 ${grid}`}
            fill="none"
            className="stroke-blueprint-line"
            strokeWidth={0.6 * u}
          />
        </pattern>
        <pattern
          id={`${uid}-major`}
          width={grid * 4}
          height={grid * 4}
          patternUnits="userSpaceOnUse"
        >
          <rect
            width={grid * 4}
            height={grid * 4}
            fill={`url(#${uid}-minor)`}
          />
          <path
            d={`M${grid * 4} 0 L0 0 0 ${grid * 4}`}
            fill="none"
            className="stroke-blueprint-line"
            strokeWidth={1.2 * u}
          />
        </pattern>
        <filter id={`${uid}-glow`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation={4 * u} />
        </filter>
      </defs>

      <rect
        width={size.width}
        height={size.height}
        className="fill-blueprint"
      />
      {plan.background ? (
        <image
          href={plan.background}
          width={size.width}
          height={size.height}
          preserveAspectRatio="xMidYMid meet"
          opacity={0.35}
        />
      ) : null}
      <rect
        width={size.width}
        height={size.height}
        fill={`url(#${uid}-major)`}
      />

      {/* Zones */}
      <g>
        {zones.map((z) => (
          <g key={z.name}>
            <path
              d={z.d}
              className="fill-blueprint-zone/15 stroke-blueprint-zone"
              strokeWidth={1.5 * u}
              strokeDasharray={z.outdoor ? `${6 * u} ${4 * u}` : undefined}
            />
            <text
              x={z.label.x}
              y={z.label.y}
              className="fill-blueprint-ink font-sans"
              fontSize={font}
              fontWeight={500}
              opacity={0.75}
            >
              {z.name}
            </text>
          </g>
        ))}
      </g>

      {/* Walls */}
      {plan.walls?.map((w, i) => (
        <polyline
          key={i}
          points={w.map((p) => p.join(",")).join(" ")}
          fill="none"
          className="stroke-blueprint-ink"
          strokeWidth={3 * u}
          strokeLinecap="square"
        />
      ))}

      {/* Fields of view */}
      <g>
        {Object.entries(plan.cameras).map(([key, cam]) => {
          const hot = routeKeys.has(key);
          return (
            <path
              key={key}
              d={fovWedge(cam, size)}
              className={cn(
                hot
                  ? "fill-track/20 stroke-track/50"
                  : "fill-camera/15 stroke-camera/35",
              )}
              strokeWidth={u}
            />
          );
        })}
      </g>

      {/* Route */}
      {points.length > 1 && (
        <g key={`route-${replayKey}`} pointerEvents="none">
          <motion.path
            d={d}
            fill="none"
            className="stroke-track"
            strokeWidth={9 * u}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={0.55}
            filter={`url(#${uid}-glow)`}
            initial={moving ? { pathLength: 0 } : false}
            animate={{ pathLength: 1 }}
            transition={{ duration, ease: "easeInOut" }}
          />
          <motion.path
            d={d}
            fill="none"
            className="stroke-track"
            strokeWidth={3 * u}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={moving ? { pathLength: 0 } : false}
            animate={{ pathLength: 1 }}
            transition={{ duration, ease: "easeInOut" }}
          />
          {arrows.map((a, i) => (
            <motion.path
              key={i}
              d={`M${-5 * u} ${-5 * u} L${4 * u} 0 L${-5 * u} ${5 * u}`}
              fill="none"
              className="stroke-track"
              strokeWidth={2.2 * u}
              strokeLinecap="round"
              strokeLinejoin="round"
              transform={`translate(${a.x} ${a.y}) rotate(${a.angle})`}
              initial={moving ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              transition={{ delay: at(i + 0.5), duration: 0.2 }}
            />
          ))}
        </g>
      )}

      {/* Camera nodes */}
      <g>
        {Object.entries(plan.cameras).map(([key, cam]) => {
          const tag = keyMap[key];
          const hot = routeKeys.has(key);
          const inScope = tag ? scope.has(tag) : false;
          const show = labels === "all" || (labels === "route" && hot);
          const name = cam.label ?? (tag ? cameraName(tag) : key);
          const clickable = !!onCameraClick;
          return (
            <g
              key={key}
              className={cn(clickable && "cursor-pointer")}
              onClick={clickable ? () => onCameraClick(key) : undefined}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              aria-label={
                clickable ? `${name}${tag ? "" : ", not mapped"}` : undefined
              }
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onCameraClick(key);
                      }
                    }
                  : undefined
              }
            >
              <title>
                {tag
                  ? `${name} (${tag})`
                  : `${key}: not mapped to a VSS camera`}
              </title>
              {(selectedKey === key || inScope) && (
                <circle
                  cx={cam.x}
                  cy={cam.y}
                  r={11 * u}
                  fill="none"
                  className={
                    selectedKey === key ? "stroke-white" : "stroke-camera"
                  }
                  strokeWidth={1.5 * u}
                />
              )}
              {clickable && (
                <circle cx={cam.x} cy={cam.y} r={14 * u} fill="transparent" />
              )}
              <circle
                cx={cam.x}
                cy={cam.y}
                r={5 * u}
                className={cn(
                  tag
                    ? hot
                      ? "fill-track"
                      : "fill-camera"
                    : "fill-blueprint stroke-blueprint-ink",
                )}
                strokeWidth={tag ? 0 : 1.5 * u}
                strokeDasharray={tag ? undefined : `${2 * u} ${2 * u}`}
              />
              {show && (
                <text
                  x={cam.x + 9 * u}
                  y={cam.y - 9 * u}
                  className={cn(
                    "font-sans",
                    hot ? "fill-white" : "fill-blueprint-ink",
                  )}
                  fontSize={font * 0.92}
                  fontWeight={hot ? 600 : 400}
                >
                  {name}
                </text>
              )}
            </g>
          );
        })}
      </g>

      {/* Numbered stops, revealed as the line reaches them */}
      <g key={`stops-${replayKey}`} pointerEvents="none">
        {route.visits.map((v, i) => {
          const last = i === route.visits.length - 1;
          return (
            <motion.g
              key={`${v.planKey}-${v.index}`}
              initial={moving ? { opacity: 0, scale: 0.4 } : false}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: at(i), duration: 0.25 }}
              style={{
                transformOrigin: `${v.mx}px ${v.my}px`,
                transformBox: "view-box",
              }}
            >
              {last && moving && (
                <motion.circle
                  cx={v.mx}
                  cy={v.my}
                  r={12 * u}
                  fill="none"
                  className="stroke-track"
                  strokeWidth={2 * u}
                  initial={{ opacity: 0.9, scale: 1 }}
                  animate={{ opacity: 0, scale: 2.2 }}
                  transition={{
                    delay: duration,
                    duration: 1.6,
                    repeat: Infinity,
                  }}
                  style={{
                    transformOrigin: `${v.mx}px ${v.my}px`,
                    transformBox: "view-box",
                  }}
                />
              )}
              <circle
                cx={v.mx}
                cy={v.my}
                r={11 * u}
                className="fill-track stroke-blueprint"
                strokeWidth={2 * u}
              />
              <text
                x={v.mx}
                y={v.my}
                dy="0.35em"
                textAnchor="middle"
                className="fill-white font-sans"
                fontSize={font}
                fontWeight={700}
              >
                {v.index}
              </text>
              {labels !== "none" && v.firstAt && (
                <text
                  x={v.mx}
                  y={v.my + 24 * u}
                  textAnchor="middle"
                  className="fill-blueprint-ink font-sans"
                  fontSize={font * 0.8}
                >
                  {formatClock(v.firstAt)}
                </text>
              )}
            </motion.g>
          );
        })}
      </g>
    </svg>
  );
}
