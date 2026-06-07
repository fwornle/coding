// PATTERN SOURCE: 45-UI-SPEC.md § Color (lines 122-137 — verbatim port)
// CONTRACT: D-45-03 "deterministic color = hsl(hash(name) % 360, S%, L%)"
//           where S/L are theme-conditioned per UI-SPEC lines 132-136.
//
// FNV-1a 32-bit hash → HSL hue. Saturation and lightness are fixed
// per theme so the same hue stays distinguishable on both backdrops
// (dark = brighter, light = muted). Drift here breaks the bit-identical
// node-color contract — pinned by color-fallback.test.ts.

export function classColor(className: string, theme: 'light' | 'dark'): string {
  // FNV-1a 32-bit
  let h = 2166136261
  for (let i = 0; i < className.length; i++) {
    h = (h ^ className.charCodeAt(i)) * 16777619
    h = h >>> 0 // keep unsigned per UI-SPEC pseudocode
  }
  const hue = h % 360
  return theme === 'dark'
    ? `hsl(${hue}, 65%, 60%)` // brighter on dark backdrop
    : `hsl(${hue}, 55%, 45%)` // muted on light backdrop
}
