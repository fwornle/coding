// PATTERN SOURCE: integrations/memory-visualizer/src/components/MarkdownViewer.tsx
// CONTRACT: 45-04-PLAN.md Task 2 + 45-UI-SPEC.md § MarkdownViewer Panel
//
// B-system signature panel — VKB port minus Mermaid (D-45-04 defers Mermaid).
// Visible only when system === 'okb' per UI-SPEC § Layout Contract row 4.
//
// Architecture:
//   1. `useGraphData` selects the current entity from `selectedNodeId`.
//   2. If `entity.metadata.markdown_url` exists, fetch its text via TanStack
//      Query (system-keyed cache to avoid leak across systems).
//   3. Otherwise, render `entity.description` directly.
//   4. Apply sanitizeMarkdownHtml() BEFORE feeding to ReactMarkdown
//      (defense layer 1: T-45-04-01 XSS mitigation).
//   5. ReactMarkdown without `rehype-raw` (defense layer 2 — react-markdown
//      escapes raw HTML by default; T-45-04-01).
//   6. Component overrides for h1-h6 (anchor IDs), img (relative-path
//      resolution + `..` escape rejection — T-45-04-05), pre/code (Mermaid
//      → placeholder div), a (smooth-scroll for `#`, .md cross-link
//      through useMarkdownHistory, external links get noopener+noreferrer
//      — T-45-04-02).
//   7. Theme-gated highlight.js CSS via a dynamic <link> element in <head>
//      (avoids importing both stylesheets, which would shadow each other).
//   8. History nav buttons (back/forward) — uses Plan 03 IconButton with
//      aria-labels 'Previous viewed entity' / 'Next viewed entity' per
//      UI-SPEC § Icon-only controls row 7.

import { useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import type { ApiClient } from '@/api/ApiClient'
import type { System } from '@/config/system-endpoints'
import { useGraphData } from '@/graph/useGraphData'
import { useViewerStore } from '@/store/viewer-store'
import { sanitizeMarkdownHtml } from '@/lib-domain/sanitize-markdown'
import { useMarkdownHistory } from '@/hooks/useMarkdownHistory'
import { IconButton } from '@/components/IconButton'
import { Logger } from '@/lib/logging'
import { EntityIdentityHeader } from './EntityIdentityHeader'

export interface MarkdownViewerPanelProps {
  apiClient: ApiClient
  system: System
}

const HLJS_LIGHT_HREF =
  'https://cdn.jsdelivr.net/npm/highlight.js@11.11.1/styles/github.min.css'
const HLJS_DARK_HREF =
  'https://cdn.jsdelivr.net/npm/highlight.js@11.11.1/styles/github-dark.min.css'
const HLJS_LINK_ID = 'unified-viewer-highlightjs-theme'

/**
 * Swap the active highlight.js CSS stylesheet based on the store's theme.
 * Idempotent — installs a single <link> in <head> the first time and only
 * mutates its `href` on subsequent calls. SSR-safe (no-op on server).
 */
function applyHighlightTheme(theme: 'light' | 'dark'): void {
  if (typeof document === 'undefined') return
  const targetHref = theme === 'dark' ? HLJS_DARK_HREF : HLJS_LIGHT_HREF
  let link = document.getElementById(HLJS_LINK_ID) as HTMLLinkElement | null
  if (!link) {
    link = document.createElement('link')
    link.id = HLJS_LINK_ID
    link.rel = 'stylesheet'
    document.head.appendChild(link)
  }
  if (link.href !== targetHref) {
    link.href = targetHref
  }
}

/**
 * Resolve a relative image path against the parent dirname of the current
 * markdown source URL. Rejects paths that escape outside the base dir via
 * `..` segments (T-45-04-05 mitigation).
 *
 * Returns null when the resolved path would escape — the caller drops the
 * image entirely rather than rendering a broken/risky src.
 */
function resolveImageSrc(
  rawSrc: string,
  baseUrl: string | null,
): string | null {
  if (!rawSrc) return null
  // Absolute URLs pass through verbatim — http(s) / data: are fine; the
  // sanitizer already converted/blocked dangerous schemes (T-45-04-01).
  if (rawSrc.startsWith('http://') || rawSrc.startsWith('https://')) {
    return rawSrc
  }
  if (rawSrc.startsWith('data:')) {
    return rawSrc
  }
  // No baseUrl context — can't resolve relative; fall through to original.
  if (!baseUrl) {
    return rawSrc
  }
  // Path-escape detection: `..` segments that pop above the base dir.
  // Count up to the first non-'..' segment.
  const segments = rawSrc.split('/').filter(Boolean)
  let upCount = 0
  for (const seg of segments) {
    if (seg === '..') upCount++
    else break
  }
  // Count the depth of baseUrl's path component.
  const baseDepth = (() => {
    try {
      const u = new URL(baseUrl)
      return u.pathname.split('/').filter(Boolean).length
    } catch {
      // Treat as a plain path fragment.
      return baseUrl.split('/').filter(Boolean).length
    }
  })()
  if (upCount >= baseDepth + 1) {
    // T-45-04-05 — would escape outside the markdown base dir.
    return null
  }
  const baseDir = baseUrl.substring(0, baseUrl.lastIndexOf('/'))
  return `${baseDir}/${rawSrc}`
}

/**
 * Generate an anchor-friendly ID for a heading (verbatim port of VKB lines
 * 280-309 — lowercase, strip non-word non-space non-hyphen, replace runs of
 * whitespace with single hyphen).
 */
function headingId(children: React.ReactNode): string {
  const text = (() => {
    if (typeof children === 'string') return children
    const arr = Array.isArray(children) ? children : [children]
    return arr
      .map((c) => (typeof c === 'string' ? c : ''))
      .join('')
  })()
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
}

/** Empty-state copy lifted verbatim from UI-SPEC § Copywriting Contract. */
const EMPTY_COPY = 'Select a node with a description to view its markdown.'

/** Mermaid placeholder copy verbatim from UI-SPEC § MarkdownViewer Panel. */
const MERMAID_PLACEHOLDER_COPY =
  'Mermaid diagrams are not rendered in MVP. Open in raw view to see the source.'

export function MarkdownViewerPanel({ apiClient, system }: MarkdownViewerPanelProps) {
  const { entities } = useGraphData(apiClient, system)
  // 2026-06-13 (Phase 56.1 Plan 05): selectedNodeId is gone — use focalNodeId.
  const selectedNodeId = useViewerStore((s) => s.focalNodeId)
  const theme = useViewerStore((s) => s.theme)
  const contentRef = useRef<HTMLDivElement>(null)
  const history = useMarkdownHistory()

  // Sync highlight.js CSS theme to the store's theme — runs on first mount
  // and on every theme change.
  useEffect(() => {
    applyHighlightTheme(theme)
  }, [theme])

  const entity = useMemo(() => {
    if (!selectedNodeId) return null
    return entities.find((e) => e.id === selectedNodeId) ?? null
  }, [entities, selectedNodeId])

  // The current entity's markdown URL (if any). `metadata.markdown_url` is
  // optional — most entities ship description-only.
  const markdownUrl = useMemo<string | null>(() => {
    if (!entity) return null
    const md = entity.metadata as { markdown_url?: unknown } | undefined
    return typeof md?.markdown_url === 'string' ? md.markdown_url : null
  }, [entity])

  // Effective URL once history nav has pushed cross-links. When the
  // history has any entries, the cursor's path overrides the entity's
  // own markdown_url so back/forward walks through linked .md files.
  const activeUrl = history.currentPath ?? markdownUrl

  // Fetch the markdown body when there IS a URL. Description fallback runs
  // unconditionally below when no URL is available.
  const fetchQuery = useQuery({
    queryKey: ['markdown', system, activeUrl],
    queryFn: async () => {
      if (!activeUrl) return ''
      const fullUrl = activeUrl.startsWith('http')
        ? activeUrl
        : `${apiClient.base}${activeUrl}`
      const res = await fetch(fullUrl, { headers: { Accept: 'text/plain' } })
      if (!res.ok) {
        Logger.error(
          Logger.Categories.API,
          `Markdown fetch failed: ${fullUrl} → HTTP ${res.status}`,
        )
        throw new Error(`HTTP ${res.status}`)
      }
      return await res.text()
    },
    enabled: !!activeUrl,
    staleTime: 30_000,
  })

  // Empty state — no entity selected.
  if (!entity) {
    return (
      <div
        data-testid="markdown-empty"
        className="flex h-full flex-col items-center justify-center p-md text-sm text-muted-foreground"
      >
        {EMPTY_COPY}
      </div>
    )
  }

  // Resolve content body — prefer fetched URL, fall back to entity.description.
  const description = (entity.description as string | null | undefined) ?? ''
  const rawContent = activeUrl
    ? fetchQuery.data ?? ''
    : description

  const sanitized = useMemo(
    () => sanitizeMarkdownHtml(rawContent),
    [rawContent],
  )

  // Loading / error states apply ONLY to the body section — the chrome
  // (header with back/forward buttons + filename) stays mounted so the user
  // can navigate away while content is in-flight.
  const isLoading = !!activeUrl && fetchQuery.isLoading
  const fetchError =
    activeUrl && fetchQuery.error
      ? fetchQuery.error instanceof Error
        ? fetchQuery.error.message
        : String(fetchQuery.error)
      : null

  // Filename / title for the header.
  const filename = (() => {
    if (activeUrl) {
      const tail = activeUrl.split('/').pop() ?? activeUrl
      return tail || entity.name
    }
    return entity.name
  })()

  // Anchor smooth-scroll into the panel content.
  const scrollToAnchor = (targetId: string) => {
    const el = document.getElementById(targetId)
    if (el && contentRef.current) {
      const containerRect = contentRef.current.getBoundingClientRect()
      const targetRect = el.getBoundingClientRect()
      const scrollTop = contentRef.current.scrollTop + targetRect.top - containerRect.top - 20
      contentRef.current.scrollTo({ top: scrollTop, behavior: 'smooth' })
    }
  }

  // Resolve a relative `.md` link against the active markdown URL's dirname.
  const resolveMdLink = (href: string): string => {
    if (href.startsWith('http://') || href.startsWith('https://')) return href
    if (!activeUrl) return href
    const baseDir = activeUrl.substring(0, activeUrl.lastIndexOf('/'))
    if (href.startsWith('/')) return href
    if (href.startsWith('./')) return `${baseDir}/${href.substring(2)}`
    if (href.startsWith('../')) {
      // Strip one ../ from href + one segment from baseDir; we accept
      // single-up only (T-45-04-05 escape control mirrors the image path
      // resolver's invariant).
      const upBase = baseDir.substring(0, baseDir.lastIndexOf('/'))
      return `${upBase}/${href.substring(3)}`
    }
    return `${baseDir}/${href}`
  }

  const components: Components = {
    img: ({ ...props }) => {
      const resolved = resolveImageSrc(props.src ?? '', activeUrl)
      if (resolved === null) return null
      return <img {...props} src={resolved} className="max-w-full h-auto" alt={props.alt ?? ''} />
    },
    pre: ({ children, ...props }) => {
      // Detect Mermaid: examine the first child <code> for a
      // language-mermaid className. Mermaid is the only fenced language
      // that the panel REPLACES with a placeholder; everything else falls
      // through to plain syntax-highlighted code rendering.
      const childArray = Array.isArray(children) ? children : [children]
      const firstChild = childArray[0] as
        | { props?: { className?: string } }
        | undefined
      const isMermaid = firstChild?.props?.className?.includes('language-mermaid')
      if (isMermaid) {
        return (
          <div
            data-testid="mermaid-placeholder"
            className="bg-muted/40 border border-dashed border-border rounded-md p-4 text-xs text-muted-foreground"
          >
            {MERMAID_PLACEHOLDER_COPY}
          </div>
        )
      }
      return (
        <pre className="bg-muted rounded-md p-4 overflow-x-auto" {...props}>
          {children}
        </pre>
      )
    },
    code: (props) => {
      const { className, children } = props as {
        className?: string
        children?: React.ReactNode
      }
      // Fenced code blocks carry a `language-*` className from
      // remark-gfm + rehype-highlight. Rehype-highlight ADDS the `hljs`
      // class plus `language-X` — typically the className looks like
      // "hljs language-ts" (order may vary). The startsWith check used by
      // VKB misses this case (className starts with "hljs"). We test
      // CONTAINS instead, and also fall back to className containing 'hljs'
      // for syntax-highlighted blocks where the language was unknown.
      const cn = typeof className === 'string' ? className : ''
      const hasLanguage = /\blanguage-/.test(cn) || /\bhljs\b/.test(cn)
      // Pass-through remaining attrs (node, etc.) WITHOUT the className we
      // already destructured. We pick out the bits we want to forward.
      const restProps = { ...props }
      delete (restProps as Record<string, unknown>).className
      delete (restProps as Record<string, unknown>).children
      delete (restProps as Record<string, unknown>).node
      if (!hasLanguage) {
        return (
          <code className="bg-muted px-1 rounded" {...restProps}>
            {children}
          </code>
        )
      }
      // Mermaid is replaced at the `pre` level — non-mermaid language-X
      // blocks fall through to rehype-highlight's wrapper. Preserve the
      // original className so the CSS scope on language-ts/language-js
      // etc. continues to work.
      return (
        <code className={cn} {...restProps}>
          {children}
        </code>
      )
    },
    h1: ({ children, ...props }) => (
      <h1 id={headingId(children)} className="text-3xl font-bold mb-4 mt-6" {...props}>
        {children}
      </h1>
    ),
    h2: ({ children, ...props }) => (
      <h2 id={headingId(children)} className="text-2xl font-bold mb-3 mt-5" {...props}>
        {children}
      </h2>
    ),
    h3: ({ children, ...props }) => (
      <h3 id={headingId(children)} className="text-xl font-bold mb-2 mt-4" {...props}>
        {children}
      </h3>
    ),
    h4: ({ children, ...props }) => (
      <h4 id={headingId(children)} className="text-lg font-semibold mb-2 mt-3" {...props}>
        {children}
      </h4>
    ),
    h5: ({ children, ...props }) => (
      <h5 id={headingId(children)} className="text-base font-semibold mb-1 mt-2" {...props}>
        {children}
      </h5>
    ),
    h6: ({ children, ...props }) => (
      <h6 id={headingId(children)} className="text-sm font-semibold mb-1 mt-2" {...props}>
        {children}
      </h6>
    ),
    a: ({ href, children, ...props }) => {
      // Anchor smooth-scroll for `#anchor` links — stay in-panel.
      if (href && href.startsWith('#')) {
        const targetId = href.substring(1)
        return (
          <button
            type="button"
            data-testid="md-anchor-link"
            className="text-primary underline cursor-pointer bg-transparent border-none p-0"
            onClick={(e) => {
              e.preventDefault()
              scrollToAnchor(targetId)
              Logger.info(Logger.Categories.PANELS, `Anchor scroll → #${targetId}`)
            }}
          >
            {children}
          </button>
        )
      }
      // Cross-link to another .md file — route through the history hook so
      // back/forward walk the chain.
      if (href && href.endsWith('.md')) {
        const resolved = resolveMdLink(href)
        return (
          <button
            type="button"
            data-testid="md-cross-link"
            className="text-primary underline cursor-pointer bg-transparent border-none p-0"
            onClick={(e) => {
              e.preventDefault()
              history.pushHistory(resolved)
              Logger.info(Logger.Categories.PANELS, `MD cross-link → ${resolved}`)
            }}
          >
            {children}
          </button>
        )
      }
      // External link — open in new tab with noopener+noreferrer
      // (T-45-04-02 mitigation).
      const isExternal = !!href && (href.startsWith('http://') || href.startsWith('https://'))
      return (
        <a
          className="text-primary underline"
          href={href}
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noopener noreferrer' : undefined}
          {...props}
        >
          {children}
        </a>
      )
    },
  }

  return (
    <div data-testid="markdown-viewer-panel" className="flex h-full flex-col gap-2">
      <header className="flex items-center justify-between gap-2 border-b border-border pb-2">
        <div className="flex items-center gap-1">
          <IconButton
            icon={ChevronLeft}
            ariaLabel="Previous viewed entity"
            tooltipText="Previous viewed entity"
            onClick={() => {
              history.back()
              Logger.info(Logger.Categories.PANELS, 'Markdown history: back')
            }}
            disabled={!history.canBack}
            data-testid="markdown-back"
          />
          <IconButton
            icon={ChevronRight}
            ariaLabel="Next viewed entity"
            tooltipText="Next viewed entity"
            onClick={() => {
              history.forward()
              Logger.info(Logger.Categories.PANELS, 'Markdown history: forward')
            }}
            disabled={!history.canForward}
            data-testid="markdown-forward"
          />
        </div>
        <h2
          data-testid="markdown-filename"
          className="text-lg font-semibold truncate flex-1 text-right"
          title={filename}
        >
          {filename}
        </h2>
      </header>

      {/* Phase 55 (Plan 09 Task 3) — shared EntityIdentityHeader harmonizes the
          Markdown panel's identity block with EntityDetailPanel. Renders ABOVE
          the markdown body so the class chip + L/parent/created/last-confirmed
          row stays visible whether the body is text or a fetched .md file. */}
      <EntityIdentityHeader entity={entity} theme={theme} />

      <div
        ref={contentRef}
        data-testid="markdown-content"
        className="prose prose-sm dark:prose-invert max-w-none overflow-y-auto flex-1"
      >
        {isLoading ? (
          <div
            data-testid="markdown-loading"
            className="flex h-full flex-col items-center justify-center gap-2 p-md text-sm text-muted-foreground"
          >
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
            <p>Loading markdown...</p>
          </div>
        ) : fetchError ? (
          <div
            data-testid="markdown-error"
            className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            Failed to load markdown: {fetchError}
          </div>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={components}
          >
            {sanitized}
          </ReactMarkdown>
        )}
      </div>
    </div>
  )
}
