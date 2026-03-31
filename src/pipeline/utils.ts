export function simpleHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h << 5) - h + input.charCodeAt(i);
    h |= 0; // 32-bit
  }
  return String(Math.abs(h));
}

export function nowIso(): string {
  return new Date().toISOString();
}

