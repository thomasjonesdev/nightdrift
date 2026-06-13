// Shared geometry for the halo button and orbiting starfield rings.

export const HALO_SIZE = 290;
export const HALO_STROKE = 1.5;
export const HALO_R = (HALO_SIZE - HALO_STROKE) / 2;
export const RING_GAP = 9;
export const RING_START = 14;

/** Innermost star orbit — just outside the halo disc (290px) plus glow room. */
export const HALO_CLEAR_R = HALO_SIZE / 2 + 10;

/** Radius in px from halo center; index 0 = outermost instrument ring. */
export function ringRadius(ringIndex: number): number {
  return HALO_R - RING_START - ringIndex * RING_GAP;
}
