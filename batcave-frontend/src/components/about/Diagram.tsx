import { useId } from 'react';
import { cn } from '@/lib/cn';

/**
 * The pieces the About page's diagrams are drawn from.
 *
 * Hand-laid SVG rather than a diagramming library, for two reasons. A library
 * would arrive with its own palette and its own type scale, and the first thing
 * anyone would notice about this page is that three boxes on it disagree with
 * every other box in the product. And a diagram of an architecture is not
 * generated content — the layout IS the argument, so it is worth placing by
 * hand, the same way the shell is.
 *
 * Colour comes from the token layer through Tailwind's `fill-*` and `stroke-*`
 * utilities, so the diagrams re-theme with everything else and cannot drift.
 * They are also deliberately achromatic: emphasis here is a lighter fill and a
 * stronger hairline, which is what depth is made of everywhere else in this
 * system, rather than a second spend of the one accent.
 */

export type Point = readonly [number, number];

/** `--radius-1`. An SVG geometry attribute cannot read a custom property. */
const RADIUS = 2;

export function Diagram({
  label,
  caption,
  width,
  height,
  children,
}: {
  /** The accessible name. Sighted readers get the caption instead. */
  label: string;
  caption: React.ReactNode;
  width: number;
  height: number;
  children: React.ReactNode;
}) {
  const titleId = useId();

  return (
    <figure className="flex flex-col gap-[var(--space-3)]">
      {/* Scrolls rather than shrinks. The labels are 9px at full size, so a
          diagram squeezed into a phone would be a picture of some text rather
          than something anyone could read. */}
      <div className="overflow-x-auto">
        <svg
          role="img"
          aria-labelledby={titleId}
          viewBox={`0 0 ${width} ${height}`}
          className="block h-auto w-full min-w-[600px] font-mono"
        >
          <title id={titleId}>{label}</title>
          {children}
        </svg>
      </div>

      <figcaption className="max-w-[640px] font-prose text-body-sm text-muted text-pretty">
        {caption}
      </figcaption>
    </figure>
  );
}

/**
 * `seam` is the one emphasis: the layer or table every arrow ends up at. It is
 * a lightness step and a stronger hairline, never the accent — amber in this
 * product means live, and a static drawing is not.
 */
type Tone = 'default' | 'seam' | 'platform';

const TONES: Record<Tone, string> = {
  default: 'fill-panel stroke-divider',
  seam: 'fill-raised stroke-strong',
  platform: 'fill-well stroke-hairline',
};

export function Box({
  x,
  y,
  w,
  h,
  title,
  lines = [],
  tone = 'default',
  dashed = false,
  size = 'md',
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  lines?: string[];
  tone?: Tone;
  /** A branch that ends the flow rather than continuing it. */
  dashed?: boolean;
  size?: 'sm' | 'md';
}) {
  const small = size === 'sm';
  const block = small ? 11 : 13 + 12 * lines.length;
  const top = y + (h - block) / 2;
  const cx = x + w / 2;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={RADIUS}
        strokeWidth={1}
        strokeDasharray={dashed ? '3 3' : undefined}
        className={TONES[tone]}
      />

      <text
        x={cx}
        y={top + (small ? 8.5 : 10)}
        textAnchor="middle"
        className={cn(small ? 'fill-secondary text-[9px]' : 'fill-primary text-[10.5px]')}
      >
        {title}
      </text>

      {lines.map((line, index) => (
        <text
          key={line}
          x={cx}
          y={top + 21 + index * 12}
          textAnchor="middle"
          className="fill-muted text-[9px]"
        >
          {line}
        </text>
      ))}
    </g>
  );
}

/** A container drawn around boxes: the Worker, or one phase of a turn. */
export function Frame({
  x,
  y,
  w,
  h,
  label,
  align = 'start',
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  /** Centre it when an arrow crosses the border where the label would sit. */
  align?: 'start' | 'middle';
}) {
  const middle = align === 'middle';

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={RADIUS}
        strokeWidth={1}
        className="fill-app stroke-strong"
      />
      <text
        x={middle ? x + w / 2 : x + 14}
        y={y + 20}
        textAnchor={middle ? 'middle' : 'start'}
        className="fill-secondary text-[9px] uppercase tracking-[var(--track-wider)]"
      >
        {label}
      </text>
    </g>
  );
}

/**
 * An orthogonal connector. Every arrow in these diagrams runs along one axis or
 * turns a right angle, so the head is a lookup rather than a rotation and no
 * marker element is needed — which also sidesteps markers being document-global
 * ids on a page holding three separate drawings.
 */
export function Arrow({
  points,
  dashed = false,
  back = false,
}: {
  points: readonly Point[];
  dashed?: boolean;
  /** A second head at the start: the two ends talk to each other. */
  back?: boolean;
}) {
  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');

  return (
    <g className="fill-control stroke-control">
      <path
        d={path}
        fill="none"
        strokeWidth={1}
        strokeDasharray={dashed ? '3 3' : undefined}
      />
      <Head from={points[points.length - 2]} to={points[points.length - 1]} />
      {back ? <Head from={points[1]} to={points[0]} /> : null}
    </g>
  );
}

function Head({ from, to }: { from: Point; to: Point }) {
  const [fx, fy] = from;
  const [tx, ty] = to;
  const dx = Math.sign(tx - fx);
  const dy = Math.sign(ty - fy);

  const points = dx
    ? `${tx},${ty} ${tx - dx * 7},${ty - 3.5} ${tx - dx * 7},${ty + 3.5}`
    : `${tx},${ty} ${tx - 3.5},${ty - dy * 7} ${tx + 3.5},${ty - dy * 7}`;

  return <polygon points={points} strokeWidth={0} />;
}

/** Text on its own: what an arrow means, or a footnote under a cluster. */
export function Note({
  x,
  y,
  anchor = 'start',
  children,
}: {
  x: number;
  y: number;
  anchor?: 'start' | 'middle' | 'end';
  children: string;
}) {
  return (
    <text x={x} y={y} textAnchor={anchor} className="fill-disabled text-[9px]">
      {children}
    </text>
  );
}

/** A heading over a group of boxes that has no frame around it. */
export function GroupLabel({ x, y, children }: { x: number; y: number; children: string }) {
  return (
    <text
      x={x}
      y={y}
      className="fill-secondary text-[9px] uppercase tracking-[var(--track-wider)]"
    >
      {children}
    </text>
  );
}

/* --- Tables, for the schema ---------------------------------------------- */

export interface Column {
  name: string;
  /** The type, the values it is checked against, or the table it points at. */
  note?: string;
  key?: 'pk' | 'fk';
}

const HEADER_H = 26;
const ROW_H = 15;

/** So a caller can place the next table without counting rows twice. */
export const tableHeight = (columns: readonly Column[]) => HEADER_H + ROW_H * columns.length;

export function Table({
  x,
  y,
  w,
  name,
  columns,
}: {
  x: number;
  y: number;
  w: number;
  name: string;
  columns: readonly Column[];
}) {
  const h = tableHeight(columns);

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={RADIUS}
        strokeWidth={1}
        className="fill-panel stroke-divider"
      />
      <path
        d={`M${x} ${y + HEADER_H} H${x + w}`}
        strokeWidth={1}
        className="stroke-divider"
      />

      <text x={x + 10} y={y + 17} className="fill-primary text-[10.5px]">
        {name}
      </text>

      {columns.map((column, index) => {
        const baseline = y + HEADER_H + ROW_H * index + 10.5;

        return (
          <g key={column.name}>
            <text
              x={x + 10}
              y={baseline}
              className={cn('text-[9px]', column.key ? 'fill-secondary' : 'fill-muted')}
            >
              {column.name}
            </text>

            {column.note ? (
              <text
                x={x + w - 10}
                y={baseline}
                textAnchor="end"
                className="fill-disabled text-[9px]"
              >
                {column.note}
              </text>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}
