/**
 * Statusline alarm glyphs: the last emoji STATE indicators became 1-cell tinted
 * dots (ALARM_DOTS), matching STATE_DOTS/LIFECYCLE_ICONS.
 *
 * Grep-gated rather than behaviour-tested, following the pattern in
 * statusline-registry-sourced.test.js: the alarm branches only fire on a
 * degraded ETM or in the last 5 minutes of a tranche, so asserting on rendered
 * output would need the whole async statusline plus a contrived clock.
 *
 * The couplings these guard are the ones that actually broke during the change:
 *   - status-line-fast.cjs matched the SYS:ERR marker by LITERAL GLYPH, so
 *     changing the glyph would have started leaking "SYS:ERR" to the user.
 *   - combined-status-line.js derived a session's STATUS by comparing its ICON
 *     against '🟡'/'🔴', so changing the glyph would have reclassified every
 *     session as healthy.
 */

import { describe, test, expect } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CSL = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'combined-status-line.js'), 'utf8');
const FAST = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'status-line-fast.cjs'), 'utf8');

/**
 * Lines that actually render, with comments removed — INCLUDING trailing ones.
 * The constant table annotates each dot with the emoji it replaced
 * (`// #ffaf00 warning (was 🟡)`), which is exactly the documentation we want
 * to keep, so a filter that only drops whole-line comments reports it as a
 * violation. Naive, but these files contain no '//' inside a string literal
 * except tmux format tags, which carry no emoji.
 */
function codeLines(src) {
  return src.split('\n')
    .map((l) => l.replace(/\/\/.*$/, ''))
    .filter((l) => {
      const t = l.trim();
      return t && !t.startsWith('*') && !t.startsWith('/*');
    });
}

describe('ALARM_DOTS replace the last emoji state indicators', () => {
  test('ALARM_DOTS is defined, bold, and on the brightest hues', () => {
    expect(CSL).toMatch(/const ALARM_DOTS = \{/);
    expect(CSL).toMatch(/WARN: '#\[fg=colour214,bold\]●#\[fg=default,nobold\]'/);
    expect(CSL).toMatch(/CRIT: '#\[fg=colour196,bold\]●#\[fg=default,nobold\]'/);
  });

  test('no emoji state indicator survives on a rendered line', () => {
    // ⏳/⏰/🔇/❓/🚫 are deliberately exempt: they say WHY a badge is not green,
    // which a severity dot cannot express. Context labels (🏥🔒📚🧠📋) stay too.
    const offenders = codeLines(CSL)
      .filter((l) => /🟡|🟠|🔴|🟢|🟤|⚫|💤|🥶/.test(l))
      // the verbose tooltip is PLAIN TEXT: a tmux #[fg=...] dot would print raw
      .filter((l) => !l.includes('lines.push') && !/^\s*(healthy|busy|stale|stalled|unreachable|disabled|unknown):/.test(l))
      // internal sentinels compared as strings, never rendered
      .filter((l) => !l.includes("globalHealth?.gcm?.icon"));
    expect(offenders).toEqual([]);
  });

  test('LSL badge and tranche alarms use ALARM_DOTS', () => {
    expect(CSL).toMatch(/parts\.push\(`\[LSL\$\{ALARM_DOTS\.CRIT\}\]`\)/);
    expect(CSL).toMatch(/parts\.push\(`\[LSL\$\{ALARM_DOTS\.WARN\}\]`\)/);
    expect(CSL).toMatch(/\$\{ALARM_DOTS\.WARN\}\$\{currentTranche\}/);
    expect(CSL).toMatch(/\$\{ALARM_DOTS\.CRIT\}\$\{currentTranche\}/);
  });

  test('session status is derived from status, NOT by comparing the icon', () => {
    // Comment-stripped: the fixed code documents the old broken form verbatim.
    const code = codeLines(CSL).join('\n');
    expect(code).not.toMatch(/icon === '🟡'/);
    expect(code).not.toMatch(/icon === '🔴'/);
    expect(code).not.toMatch(/sessionStatuses\.includes\('🔴'\)/);
    expect(code).toMatch(/const sessionStatus = status === 'healthy'/);
  });

  test('fast-path marker detection is glyph-agnostic', () => {
    // Must strip #[...] before testing, or a formatted dot is invisible to it.
    expect(FAST).toMatch(/replace\(\/#\\\[\[\^\\\]\]\*\\\]\/g, ''\)/);
    expect(FAST).toMatch(/SYS:\(TIMEOUT\|ERR\)/);
    const re = /^\s*(?:⚠️?|🟡|●)\s*SYS:(TIMEOUT|ERR)\b/;
    const strip = (s) => s.trimStart().replace(/#\[[^\]]*\]/g, '').trimStart();
    // new form, both legacy forms, and a real payload that must NOT match
    expect(re.test(strip('#[fg=colour196,bold]●#[fg=default,nobold] SYS:ERR'))).toBe(true);
    expect(re.test(strip('   #[fg=colour196,bold]●#[fg=default,nobold] SYS:TIMEOUT'))).toBe(true);
    expect(re.test(strip('🟡 SYS:ERR'))).toBe(true);
    expect(re.test(strip('⚠️ SYS:TIMEOUT'))).toBe(true);
    expect(re.test(strip('[🏥#[fg=colour41]●#[fg=default]] [📋10-11] 10:08'))).toBe(false);
  });

  test('the lifecycle patcher cannot overwrite an alarm dot', () => {
    // lifecycleAlt is built from the five exact ramp strings; alarm dots carry
    // ,bold]/,nobold] tags that none of them have, so they can never match.
    const ramp = FAST.match(/const LIFECYCLE_ICONS = \[[\s\S]*?\];/)[0];
    expect(ramp).not.toMatch(/bold/);
    expect(ramp.match(/#\[fg=colour\d+\]●#\[fg=default\]/g)).toHaveLength(5);
  });
});
