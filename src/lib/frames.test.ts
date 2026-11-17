import { describe, expect, it } from 'vitest';
import { insertAt, moveItem, removeAt } from './frames';

describe('frames helpers', () => {
  it('moves items forward and backward', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
  it('inserts and removes without mutating', () => {
    const src = ['a', 'b'];
    expect(insertAt(src, 1, 'x', 'y')).toEqual(['a', 'x', 'y', 'b']);
    expect(insertAt(src, 99, 'z')).toEqual(['a', 'b', 'z']);
    expect(removeAt(src, 0)).toEqual(['b']);
    expect(removeAt(src, 7)).toEqual(['a', 'b']);
    expect(src).toEqual(['a', 'b']);
  });
});
