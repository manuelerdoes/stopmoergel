/** Pure, immutable helpers for frame-list operations. */

export function moveItem<T>(arr: readonly T[], from: number, to: number): T[] {
  const out = arr.slice();
  if (from < 0 || from >= out.length) return out;
  const [item] = out.splice(from, 1);
  const target = Math.max(0, Math.min(to, out.length));
  out.splice(target, 0, item);
  return out;
}

export function insertAt<T>(arr: readonly T[], index: number, ...items: T[]): T[] {
  const out = arr.slice();
  out.splice(Math.max(0, Math.min(index, out.length)), 0, ...items);
  return out;
}

export function removeAt<T>(arr: readonly T[], index: number): T[] {
  if (index < 0 || index >= arr.length) return arr.slice();
  return [...arr.slice(0, index), ...arr.slice(index + 1)];
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
