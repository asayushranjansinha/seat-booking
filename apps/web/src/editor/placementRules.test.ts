/**
 * Which seat rules a table can take.
 *
 * <p>Worth testing because the failure mode is not a wrong seat position but a crashed
 * editor: `placeSeats` throws for a rule its shape cannot satisfy, and a throw inside a
 * store action takes the whole layout to an error overlay.
 */
import { describe, expect, it } from 'vitest';
import { ruleSuitsShape, whyRuleCannotApply } from './placementRules';
import type { ShapeJson } from '@/api/types';

const RECT: ShapeJson = { kind: 'RECT', w: 2.4, h: 1.2 };
const CIRCLE: ShapeJson = { kind: 'CIRCLE', r: 0.9 };
const ELLIPSE: ShapeJson = { kind: 'ELLIPSE', rx: 1.2, ry: 0.8 };
const POLYGON: ShapeJson = { kind: 'POLYGON', points: [[-1, -1], [1, -1], [1, 1], [-1, 1]] };

describe('radial placement', () => {
  it('needs a shape with a radius to place seats around', () => {
    expect(ruleSuitsShape('RADIAL', CIRCLE)).toBe(true);
    expect(ruleSuitsShape('RADIAL', ELLIPSE)).toBe(true);
  });

  it('is refused for shapes that have no single radius', () => {
    // The bug this exists for: the menu offered it for a rectangle, placeSeats threw, and
    // the editor dropped to a crash overlay.
    expect(ruleSuitsShape('RADIAL', RECT)).toBe(false);
    expect(ruleSuitsShape('RADIAL', POLYGON)).toBe(false);
  });

  it('says why, so the menu can show a reason rather than a greyed-out row', () => {
    expect(whyRuleCannotApply('RADIAL', RECT)).toBe('Round tables only');
    expect(whyRuleCannotApply('RADIAL', CIRCLE)).toBeNull();
  });
});

describe('the rules that fit anything', () => {
  it('allows the other three on every shape', () => {
    for (const shape of [RECT, CIRCLE, ELLIPSE, POLYGON]) {
      for (const kind of ['PERIMETER_EVEN', 'EDGE_COUNTS', 'MANUAL'] as const) {
        expect(ruleSuitsShape(kind, shape)).toBe(true);
        expect(whyRuleCannotApply(kind, shape)).toBeNull();
      }
    }
  });
});
