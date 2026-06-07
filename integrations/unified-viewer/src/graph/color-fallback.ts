// PATTERN SOURCE: 45-UI-SPEC.md § Color (lines 122-137 — verbatim port)
// CONTRACT: D-45-03 "deterministic color = hsl(hash(name) % 360, S%, L%)"
//           where S/L are theme-conditioned per UI-SPEC lines 132-136.
//
// FNV-1a 32-bit hash → HSL hue. Saturation and lightness are fixed
// per theme so the same hue stays distinguishable on both backdrops
// (dark = brighter, light = muted).
//
// Output is hex (#rrggbb) — Sigma's WebGL color parser silently rejects
// `hsl(...)` strings and falls back to black, so the spec's perceptual
// HSL contract is honored via `hslToHex` conversion. Hue/S/L values are
// computed identically to UI-SPEC § Color; only the output format differs.
// (Drift in the FNV-1a hash → hue mapping is still pinned by the test.)

function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100
  const ln = l / 100
  const a = sn * Math.min(ln, 1 - ln)
  const f = (n: number): number => {
    const k = (n + h / 30) % 12
    const c = ln - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)))
    return Math.round(c * 255)
  }
  const toHex = (x: number): string => x.toString(16).padStart(2, '0')
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`
}

export function classColor(className: string, theme: 'light' | 'dark'): string {
  // FNV-1a 32-bit
  let h = 2166136261
  for (let i = 0; i < className.length; i++) {
    h = (h ^ className.charCodeAt(i)) * 16777619
    h = h >>> 0 // keep unsigned per UI-SPEC pseudocode
  }
  const hue = h % 360
  return theme === 'dark'
    ? hslToHex(hue, 65, 60) // brighter on dark backdrop
    : hslToHex(hue, 55, 45) // muted on light backdrop
}

/** Internal export — used by tests to verify hue derivation independent of format. */
export function _classHue(className: string): number {
  let h = 2166136261
  for (let i = 0; i < className.length; i++) {
    h = (h ^ className.charCodeAt(i)) * 16777619
    h = h >>> 0
  }
  return h % 360
}
