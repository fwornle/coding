// PATTERN SOURCE: integrations/memory-visualizer/src/components/MarkdownViewer.tsx:8-29
// CONTRACT: 45-04-PLAN.md Task 2 must_haves.sanitizer — VERBATIM PORT of the
//   6-step regex pipeline. Rewriting any of the regexes invalidates the
//   T-45-04-01 mitigation envelope (XSS defense-in-depth) — react-markdown
//   provides the second layer of safety by escaping raw HTML by default,
//   but the sanitizer is the documented contract surface.
//
// The 6 steps:
//   1. <a href="x"><img src=".." alt=".."/></a> → [![alt](src)](href)  (both attr orders)
//   2. Standalone <img> → ![alt](src)  (both attr orders)
//   3. <a href="x">simple-text</a> → [text](x)
//   4. <br> and <br/> → '  \n'  (two-space + newline — Markdown line-break)
//   5. Strip HTML block tags but keep content: div, picture, source, p, center
//   6. Fix leading-space images (would otherwise render as code blocks) +
//      collapse 3+ consecutive newlines to 2.
//
// NOTE: this function intentionally does NOT strip <script>, <iframe>, or
// other dangerous tags — those are NOT included in step-5's allowlist, so
// they pass through to react-markdown, which (by default, without
// rehype-raw) escapes them as TEXT in the output DOM. The sanitizer test
// asserts the full pipeline (sanitizer + react-markdown) emits no <script>
// element in the rendered DOM.

/**
 * Strip inline HTML blocks from markdown content so ReactMarkdown doesn't
 * render raw tags. Converts common HTML patterns (badges, centered images)
 * to their Markdown equivalents. Verbatim port from VKB.
 */
export function sanitizeMarkdownHtml(content: string): string {
  // Step 1: Convert <a href="..."><img ...></a> to [![alt](img-src)](link-href)
  content = content.replace(
    /<a\s+href="([^"]*)"[^>]*>\s*<img\s+[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>\s*<\/a>/gi,
    '[![$3]($2)]($1)',
  )
  content = content.replace(
    /<a\s+href="([^"]*)"[^>]*>\s*<img\s+[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>\s*<\/a>/gi,
    '[![$2]($3)]($1)',
  )
  // Step 2: Convert standalone <img> to ![alt](src)
  content = content.replace(
    /<img\s+[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi,
    '![$2]($1)',
  )
  content = content.replace(
    /<img\s+[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>/gi,
    '![$1]($2)',
  )
  // Step 3: Convert <a href="...">text</a> to [text](href) — only for simple text content
  content = content.replace(/<a\s+href="([^"]*)"[^>]*>([^<]*)<\/a>/gi, '[$2]($1)')
  // Step 4: Convert <br> and <br/> to markdown line breaks
  content = content.replace(/<br\s*\/?>/gi, '  \n')
  // Step 5: Remove remaining HTML block tags but keep their content
  content = content.replace(/<\/?(div|picture|source|p|center)[^>]*>/gi, '')
  // Step 6: Fix indentation — lines that start with spaces followed by ![ or [![ are images
  // that were inside HTML blocks. Remove leading spaces to prevent code block rendering.
  content = content.replace(/^[ \t]+(!\[)/gm, '$1')
  // Clean up excessive blank lines from tag removal
  content = content.replace(/\n{3,}/g, '\n\n')
  return content
}
