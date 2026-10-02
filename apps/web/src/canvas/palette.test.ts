import { describe, expect, it } from 'vitest';
import { hashId, shade, TABLE_PALETTE, tableColour } from './palette';

describe('tableColour', () => {
  it('gives one table the same colour every time', () => {
    // The whole reason it hashes the id rather than counting position: a table that
    // changed colour as it was dragged past another would look like a fault.
    const id = '7b3f1c22-0a4e-4a51-9e0a-2f1c3d4e5f60';
    expect(tableColour(id)).toBe(tableColour(id));
  });

  it('only ever returns a colour from the palette', () => {
    for (let i = 0; i < 200; i++) {
      expect(TABLE_PALETTE).toContain(tableColour(`table-${i}`));
    }
  });

  it('depends on the ORDER of the characters, not just which ones', () => {
    // Asserted on the HASH, not on the colour. Anything that merely accumulates
    // characters — summing them, or xor-ing them — gives two anagrams the same answer,
    // and sequential UUIDs are full of near-anagrams. Two different hashes still land in
    // the same slot one time in eight, so asserting the colours differ would be a test
    // that fails on a working implementation.
    expect(hashId('abcd1234')).not.toBe(hashId('dcba4321'));
    expect(hashId('0a4e4a51')).not.toBe(hashId('4a510a4e'));
  });

  it('spreads UUIDs that share a prefix', () => {
    // UUIDs minted in one batch often share their leading characters, and a hash that
    // simply sums them would hand that whole batch one colour.
    const ids = Array.from({ length: 64 }, (_, i) =>
      `7b3f1c22-0a4e-4a51-9e0a-2f1c3d4e5f${i.toString(16).padStart(2, '0')}`);
    const used = new Set(ids.map(tableColour));
    // Not a demand for perfect balance — just that it is using the palette rather than
    // collapsing onto one or two slots.
    expect(used.size).toBeGreaterThanOrEqual(TABLE_PALETTE.length - 2);
  });
});

describe('shade', () => {
  it('darkens each channel', () => {
    expect(shade(0x804020, 0.5)).toBe(0x402010);
  });

  it('clamps instead of wrapping when it brightens', () => {
    // A channel that runs past 255 carries into the next one, and a lightened blue comes
    // back green. The edge colour asks for 1.5x, so this is not hypothetical.
    expect(shade(0xc0c0c0, 1.5)).toBe(0xffffff);
    // 63 x 1.5 is 94.5, and Math.round takes a half upward, so this channel is 0x5f.
    expect(shade(0x3f4a5a, 1.5)).toBe(0x5f6f87);
  });

  it('leaves a colour alone at 1', () => {
    expect(shade(0x3a4a63, 1)).toBe(0x3a4a63);
  });
});
