// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

/**
 * ZoneEditor
 * ----------
 * Edits a loitering zone as numbered points. A small sketch of the zone sits
 * in the middle, and each point's X/Y boxes sit at the sketch corner the point
 * belongs to, with the same number as the sketch's corner marker. A thumbnail
 * shows where the zone lies in the video frame.
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, X, RotateCcw } from 'lucide-react';

import { MIN_ZONE_POINTS, isValidCoord, isValidPoint, nextCorner } from './zonePoints';

const ZONE_COLOR = '#FFA000'; // matches the zone overlay in Smart Client
const NUMBER_COLOR = '#0071C5';
const SKETCH_W = 112;
const SKETCH_H = 62;
const SKETCH_PAD = 10;
const FRAME_W = 96;
const FRAME_H = 54;

// Grid cell, alignment and box order for each corner of the sketch.
const CORNER_LAYOUT = {
  tl: { cell: 'col-start-1 row-start-1 self-start justify-self-end', side: 'left' },
  tr: { cell: 'col-start-3 row-start-1 self-start justify-self-start', side: 'right' },
  bl: { cell: 'col-start-1 row-start-2 self-end justify-self-end', side: 'left' },
  br: { cell: 'col-start-3 row-start-2 self-end justify-self-start', side: 'right' },
};

const NO_SPINNER = '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

function NumberBadge({ n }) {
  return (
    <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-[#0071C5] bg-white text-[0.66rem] font-bold text-[#0071C5]">
      {n}
    </span>
  );
}

function CoordBox({ label, value, invalid, disabled, onChange, ariaLabel }) {
  return (
    <label className="flex items-center gap-[3px]">
      <span className="text-[0.66rem] font-bold text-[#8695B8]">{label}</span>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        max={1}
        step={0.01}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-label={ariaLabel}
        aria-invalid={invalid}
        className={`h-7 w-[4.1rem] px-1.5 font-mono text-[0.76rem] ${NO_SPINNER} ${invalid ? 'border-red-400' : ''}`}
      />
    </label>
  );
}

/** One point's boxes; the number badge faces the sketch, the remove button faces out. */
function PointBoxes({ index, point, side, disabled, canRemove, onChange, onRemove }) {
  const n = index + 1;
  const remove = (
    <Button type="button" size="icon-xs" variant="ghost" className="text-[#8695B8]"
      disabled={disabled || !canRemove}
      title={canRemove ? `Remove point ${n}` : `A zone needs at least ${MIN_ZONE_POINTS} points`}
      aria-label={`Remove point ${n}`}
      onClick={onRemove}>
      <X size={12} />
    </Button>
  );
  const boxes = (
    <>
      <CoordBox label="X" value={point.x} invalid={!isValidCoord(point.x)} disabled={disabled}
        ariaLabel={`Point ${n} X`} onChange={(v) => onChange({ ...point, x: v })} />
      <CoordBox label="Y" value={point.y} invalid={!isValidCoord(point.y)} disabled={disabled}
        ariaLabel={`Point ${n} Y`} onChange={(v) => onChange({ ...point, y: v })} />
    </>
  );
  return (
    <div className="flex items-center gap-[5px]">
      {side === 'left' ? <>{remove}{boxes}<NumberBadge n={n} /></> : <><NumberBadge n={n} />{boxes}{remove}</>}
    </div>
  );
}

/** The zone drawn to fill the sketch, with each point's number at its corner. */
function ZoneSketch({ points }) {
  const drawn = points.map((p, i) => ({ ...p, n: i + 1 })).filter(isValidPoint);
  const inner = (
    <rect x={SKETCH_PAD} y={SKETCH_PAD} width={SKETCH_W - 2 * SKETCH_PAD} height={SKETCH_H - 2 * SKETCH_PAD}
      fill="none" stroke="#C5CEE3" strokeDasharray="3 3" />
  );
  if (drawn.length < MIN_ZONE_POINTS) {
    return (
      <svg width={SKETCH_W} height={SKETCH_H} role="img" aria-label="Zone sketch (zone incomplete)">{inner}</svg>
    );
  }
  const xs = drawn.map((p) => Number(p.x));
  const ys = drawn.map((p) => Number(p.y));
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const sx = (v) => SKETCH_PAD + (maxX > minX ? (v - minX) / (maxX - minX) : 0.5) * (SKETCH_W - 2 * SKETCH_PAD);
  const sy = (v) => SKETCH_PAD + (maxY > minY ? (v - minY) / (maxY - minY) : 0.5) * (SKETCH_H - 2 * SKETCH_PAD);
  const outline = drawn.map((p) => `${sx(Number(p.x))},${sy(Number(p.y))}`).join(' ');
  return (
    <svg width={SKETCH_W} height={SKETCH_H} role="img" aria-label="Zone sketch with numbered points">
      <polygon points={outline} fill={ZONE_COLOR} fillOpacity="0.18" stroke={ZONE_COLOR} strokeWidth="2" />
      {drawn.map((p) => (
        <g key={p.n}>
          <circle cx={sx(Number(p.x))} cy={sy(Number(p.y))} r="7" fill="white" stroke={NUMBER_COLOR} strokeWidth="1.5" />
          <text x={sx(Number(p.x))} y={sy(Number(p.y)) + 3} textAnchor="middle" fontSize="9" fontWeight="700"
            fill={NUMBER_COLOR}>{p.n}</text>
        </g>
      ))}
    </svg>
  );
}

/** Thumbnail of the video frame with the zone at its real position. */
function FramePreview({ points }) {
  const drawn = points.filter(isValidPoint);
  const outline = drawn.map((p) => `${Number(p.x) * FRAME_W},${Number(p.y) * FRAME_H}`).join(' ');
  return (
    <div className="flex flex-col items-center gap-[2px]">
      <svg width={FRAME_W} height={FRAME_H} role="img" aria-label="Zone position in the video frame"
        className="rounded-[3px] border border-[#C5CEE3] bg-[#F5F7FD]">
        {drawn.length >= MIN_ZONE_POINTS && (
          <polygon points={outline} fill={ZONE_COLOR} fillOpacity="0.35" stroke={ZONE_COLOR} strokeWidth="1.5" />
        )}
      </svg>
      <span className="text-[0.62rem] text-[#8695B8]">Position in frame</span>
    </div>
  );
}

export default function ZoneEditor({ points, defaultPoints, disabled, onChange }) {
  const update = (i, point) => onChange(points.map((p, j) => (j === i ? point : p)));
  const remove = (i) => onChange(points.filter((_, j) => j !== i));
  const add = () => onChange([...points, { x: '', y: '', corner: nextCorner(points) }]);
  const canRemove = points.length > MIN_ZONE_POINTS;

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="grid grid-cols-[auto_auto_auto] grid-rows-[auto_auto] gap-x-[8px] gap-y-[6px]">
        {Object.entries(CORNER_LAYOUT).map(([corner, { cell, side }]) => (
          <div key={corner} className={`flex flex-col gap-[6px] ${cell}`}>
            {points.map((p, i) => (p.corner === corner ? (
              <PointBoxes key={i} index={i} point={p} side={side} disabled={disabled} canRemove={canRemove}
                onChange={(next) => update(i, next)} onRemove={() => remove(i)} />
            ) : null))}
          </div>
        ))}
        <div className="col-start-2 row-span-2 row-start-1 flex items-center justify-center">
          <ZoneSketch points={points} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <FramePreview points={points} />
        <div className="flex flex-col items-start gap-[4px]">
          <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[0.72rem]"
            disabled={disabled} title="Add a point to the zone outline" onClick={add}>
            <Plus size={12} className="mr-0.5" />Point
          </Button>
          {defaultPoints.length > 0 && (
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[0.72rem] text-[#4A5C80]"
              disabled={disabled} title="Reset to the zone configured in VAP"
              onClick={() => onChange(defaultPoints)}>
              <RotateCcw size={12} className="mr-0.5" />Reset
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
