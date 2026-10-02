/**
 * Which seat rules a given table can actually take.
 *
 * <p>`placeSeats` throws for a rule its shape cannot satisfy, and a throw inside a store
 * action is an unhandled render error: the editor goes to a crash overlay and the layout
 * is unreachable until the page is reloaded. Offering a rule the table cannot have is
 * therefore not a cosmetic problem, so the question is asked in one place and both the
 * menu and the store ask it.
 */
import type { PlacementJson, ShapeJson } from '@/api/types';

/** Whether this kind of rule can be applied to this shape. */
export function ruleSuitsShape(kind: PlacementJson['kind'], shape: ShapeJson): boolean {
  // Radial placement puts seats at angles around a centre, which needs a radius to put
  // them at. A rectangle has no single one.
  if (kind === 'RADIAL') return shape.kind === 'CIRCLE' || shape.kind === 'ELLIPSE';
  return true;
}

/** Why a rule is unavailable, for the menu to say so instead of just greying it out. */
export function whyRuleCannotApply(
  kind: PlacementJson['kind'], shape: ShapeJson,
): string | null {
  if (ruleSuitsShape(kind, shape)) return null;
  if (kind === 'RADIAL') return 'Round tables only';
  return 'Not available for this shape';
}
