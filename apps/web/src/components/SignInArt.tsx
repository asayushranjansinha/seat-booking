/** Seats around the round table, each turned to face it. */
const RADIAL_SEATS = [
  { x: 392, y: 105, rot: 90, fill: 'var(--seat-free)' },
  { x: 366, y: 150, rot: 150, fill: 'var(--seat-free)' },
  { x: 314, y: 150, rot: 210, fill: 'var(--seat-booked)' },
  { x: 288, y: 105, rot: 270, fill: 'var(--seat-free)' },
  { x: 314, y: 60, rot: 330, fill: 'var(--seat-free)' },
  { x: 366, y: 60, rot: 30, fill: 'var(--seat-booked)' },
];

/** Seats along the bench. The one marked `booking` cycles free → booked → free. */
const BENCH_SEATS = [
  { x: 114, y: 60, fill: 'var(--seat-free)', booking: false },
  { x: 139, y: 60, fill: 'var(--seat-free)', booking: false },
  { x: 164, y: 60, fill: 'var(--seat-booked)', booking: false },
  { x: 114, y: 131, fill: 'var(--seat-free)', booking: true },
  { x: 139, y: 131, fill: 'var(--seat-mine)', booking: false },
  { x: 164, y: 131, fill: 'var(--seat-free)', booking: false },
];

/**
 * The floor plan shown beside the sign-in form.
 *
 * <p>It is the product's own output rather than decoration: a rectangular room with a
 * bench, a circular room with a radial table, seats placed around both. The seats carry
 * the same three tokens the real canvas uses, so the colour language is already learned
 * by the time someone signs in and sees it for real.
 *
 * <p>The bench and its seats are one group, and the group is what moves. That is the
 * claim the panel makes in words — move a table and its seats come with it — performed
 * rather than illustrated, and it is how the real scene graph behaves. The animation
 * itself lives in `globals.css`, where it can be turned off for reduced motion.
 *
 * <p>Metres are not meaningful here: this is a portrait of a floor, not a floor. Plain
 * SVG, because the sign-in page has not loaded three.js and should not have to.
 */
export function SignInArt() {
  return (
    <svg
      viewBox="0 0 440 210"
      role="img"
      aria-label="A floor plan: a rectangular room with a bench table and a circular room with a round table, seats around both coloured by availability."
      className="h-auto w-full max-w-xl"
    >
      <defs>
        <pattern id="plan-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path
            d="M20 0H0V20"
            fill="none"
            stroke="var(--border)"
            strokeWidth="0.5"
            opacity="0.5"
          />
        </pattern>
      </defs>

      <rect
        x="0"
        y="0"
        width="440"
        height="210"
        fill="url(#plan-grid)"
        className="plan-fade"
      />

      {/* Walls, drawn on. The class sits on each element rather than the group: stroke
          dashing does inherit, but an animated inherited value is a fragile thing to
          rely on, and per-element delays let the rooms arrive one after the other. */}
      <g stroke="var(--muted-foreground)" strokeWidth="2" fill="none" opacity="0.65">
        <path pathLength={1} d="M40 180V30h220v150h-60" className="plan-draw" />
        <path pathLength={1} d="M160 180H40" className="plan-draw" />
        <circle
          pathLength={1}
          cx="340"
          cy="105"
          r="75"
          className="plan-draw"
          style={{ animationDelay: '0.35s' }}
        />
        <path
          pathLength={1}
          d="M160 180v-40"
          strokeWidth="1.5"
          className="plan-draw"
          style={{ animationDelay: '0.9s' }}
        />
        <path
          pathLength={1}
          d="M200 180A40 40 0 0 0 160 140"
          strokeWidth="1"
          opacity="0.7"
          className="plan-draw"
          style={{ animationDelay: '1s' }}
        />
      </g>

      {/* The bench and everything seated at it: one group, so one transform moves it all. */}
      <g className="plan-bench">
        <rect
          x="105"
          y="80"
          width="90"
          height="45"
          rx="3"
          fill="var(--card)"
          stroke="var(--border)"
          strokeWidth="1.5"
          className="plan-fade"
          style={{ animationDelay: '1.1s' }}
        />
        {BENCH_SEATS.map((seat, i) => (
          <rect
            key={`${seat.x}-${seat.y}`}
            x={seat.x}
            y={seat.y}
            width={22}
            height={14}
            rx={3}
            fill={seat.fill}
            // plan-book carries its own fade, so it must not also carry plan-fade.
            className={seat.booking ? 'plan-book' : 'plan-fade'}
            style={seat.booking ? undefined : { animationDelay: `${1.4 + i * 0.08}s` }}
          />
        ))}
      </g>

      <circle
        cx="340"
        cy="105"
        r="30"
        fill="var(--card)"
        stroke="var(--border)"
        strokeWidth="1.5"
        className="plan-fade"
        style={{ animationDelay: '1.1s' }}
      />

      {/* Radial seats orbit slowly, which is the placement rule restated. */}
      <g className="plan-orbit">
        {RADIAL_SEATS.map((seat, i) => (
          <rect
            key={`${seat.x}-${seat.y}`}
            x={-10}
            y={-6.5}
            width={20}
            height={13}
            rx={3}
            fill={seat.fill}
            transform={`translate(${seat.x} ${seat.y}) rotate(${seat.rot})`}
            className="plan-fade"
            style={{ animationDelay: `${1.5 + i * 0.08}s` }}
          />
        ))}
      </g>
    </svg>
  );
}
