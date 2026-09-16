/**
 * Visible-cell count for a status-line string.
 *
 * THE single source of truth for status-line width. It lives in its own file
 * because it had a second, divergent copy in tests/features/surface-gating.test.mjs
 * — a hand-rolled "score wide glyphs as 2" that was missing the 0x2300-0x23FF
 * (⏰⏳) and 0x2600-0x27BF (✅⚫❌❗❓) ranges. Both are glyphs this status line
 * really emits, so the moment a badge went to a warning/timer state the copy
 * measured 1 cell short per occurrence and the padding-invariance test failed
 * intermittently, blaming the padder for its own arithmetic.
 *
 * Anything that needs to measure a status-line string imports this. Do not
 * re-implement it — see memory/reference_tmux_emoji_width_fix.md; width changes
 * here are the third recurring mistake in this area and surface as trailing-char
 * residue in VS Code's xterm.js.
 */
// Visible-cell count for a status-line string. Treats tmux style markers
// (#[fg=...] etc.) as zero-width, drops zero-width combining characters,
// and — critically — counts emoji at TWO cells, matching what tmux and
// macOS/iTerm terminals actually render.
//
// Previous version counted every codepoint as 1 cell, which under-counted
// emoji width by a factor of two. With ~6 emojis in the status line that
// adds up to a ~6-12 cell deficit: the padder thinks the content is short
// and adds fewer leading spaces than needed, so the rendered line is wider
// than the pane and content gets pushed away from the right edge. Phase
// 34-05's [🧠] badge pushed this past the visible-drift threshold.
function visibleCellWidth(s) {
  const stripped = String(s).replace(/#\[[^\]]*\]/g, '');
  // Codepoint-by-codepoint iteration with VS16 lookahead — needed because
  // U+FE0F (emoji variation selector) following an Ambiguous-Width base
  // codepoint promotes it to 2-cell emoji presentation in xterm.js / tmux,
  // even though the base codepoint alone would render as 1 cell. Without
  // the lookahead, "⚠" was counted at 1 cell while terminals actually
  // rendered "⚠️" (with VS16) at 2 cells — a 1-cell drift per occurrence
  // and the direct cause of the "07:538" / "07:054" trailing-digit residue.
  const chars = [...stripped];
  let width = 0;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const cp = ch.codePointAt(0);
    if (cp == null) continue;
    if (cp === 0xFE0F) continue;                          // emoji variation selector (consumed below via lookahead)
    if (cp >= 0x0300 && cp <= 0x036F) continue;           // combining diacriticals
    if (cp >= 0x200B && cp <= 0x200D) continue;           // ZWSP / ZWNJ / ZWJ

    // Lookahead for VS16 (U+FE0F): forces emoji presentation = 2 cells.
    const nextCp = i + 1 < chars.length ? chars[i + 1].codePointAt(0) : null;
    const hasVS16 = nextCp === 0xFE0F;

    // East Asian Width "Ambiguous" codepoints: tmux + xterm in a non-East-
    // Asian locale count these as 1 cell (NOT 2) despite their wide
    // visual rendering. Hand-picked from this script's emoji repertoire.
    // The original Wide-range catch-all below treated them as 2 cells,
    // which over-counted by 1 cell per occurrence and produced the
    // recurring trailing-residue artifact ("13:32865", "14:2625"):
    // tmux's cell-clear math used its own (smaller) wcwidth so cells the
    // script thought it was covering were left exposed from the
    // previous render. Peeling Ambiguous off Wide brings the two counts
    // back into agreement.
    //
    // Exception: if VS16 follows, emoji-presentation is forced — count 2.
    // To add new codepoints here, verify their EAW class via
    // https://www.unicode.org/Public/UCD/latest/ucd/EastAsianWidth.txt
    // AND confirm tmux's actual rendering in this user's terminal.
    const isAmbiguousNarrow =
      cp === 0x26A0 ||                                    // ⚠ warning sign
      cp === 0x2699 ||                                    // ⚙ gear
      cp === 0x23F8 ||                                    // ⏸ pause
      cp === 0x2501;                                      // ━ heavy horizontal
    if (isAmbiguousNarrow) {
      width += hasVS16 ? 2 : 1;
      continue;
    }

    // Confirmed EAW=Wide ranges. The 0x2600-0x27BF block contains both
    // Wide (✅⚫❌❗❓🚫) and Ambiguous (⚠⚙) codepoints — the explicit
    // Ambiguous list above peels off the latter before this catch-all.
    const isWide =
      (cp >= 0x1F300 && cp <= 0x1FAFF) ||   // misc pictographs, emoticons, symbols & pictographs ext-A
      (cp >= 0x2600  && cp <= 0x27BF)  ||   // misc symbols + dingbats (✅⚫❌)
      (cp >= 0x2300  && cp <= 0x23FF)  ||   // misc technical (⏰⏳)
      (cp >= 0x1F000 && cp <= 0x1F2FF) ||   // mahjong/domino/playing-card + enclosed alphanum
      (cp >= 0x1F680 && cp <= 0x1F6FF);     // transport & map symbols
    width += isWide ? 2 : 1;
  }
  return width;
}

module.exports = { visibleCellWidth };
