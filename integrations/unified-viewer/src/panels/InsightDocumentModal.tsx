// InsightDocumentModal — renders an `.md` file under
// knowledge-management/insights/ as a modal overlay using react-markdown
// (same renderer the MarkdownViewerPanel uses for the OKB system).
//
// Added 2026-06-11 so the "View Insight Document" link no longer opens
// raw text in a new tab — user feedback: "why don't you just re-use the
// code?!". Re-uses MarkdownViewerPanel's sanitize + GFM + highlight chain.
//
// 2026-06-11 (later): in-place navigation. Cross-doc links inside the
// modal (e.g. `[Pipeline](Pipeline.md)`) used to open a new browser tab
// at localhost:8080 — losing the modal context entirely. Now intercepted:
// clicking a .md link swaps the modal's current URL and pushes the
// previous URL onto a back stack so the user can step back. External
// links and non-.md links open in a new tab as before.

import { useEffect, useState, useCallback } from 'react'
import type { AnchorHTMLAttributes, MouseEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { sanitizeMarkdownHtml } from '@/lib-domain/sanitize-markdown'

interface InsightDocumentModalProps {
  url: string
  title: string
  onClose: () => void
}

export function InsightDocumentModal({ url, title, onClose }: InsightDocumentModalProps) {
  // Track the doc currently shown; starts at the prop, mutates as the user
  // navigates between linked .md files. Back stack lets them retrace.
  const [currentUrl, setCurrentUrl] = useState(url)
  const [history, setHistory] = useState<string[]>([])

  // ESC to close — same affordance as the SidePanel.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const { data, isLoading, isError } = useQuery({
    queryKey: ['insight-doc', currentUrl],
    queryFn: async () => {
      const res = await fetch(currentUrl)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return res.text()
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  const sanitized = data ? sanitizeMarkdownHtml(data) : ''

  // 2026-06-11: Relative image / link refs in the .md (e.g.
  // `images/lazy-loader-architecture.png`) are resolved by the browser
  // against the CURRENT page URL (localhost:5173/viewer/coding) — which
  // 404s. The correct base is the markdown's own origin + directory
  // (e.g. http://localhost:8080/knowledge-management/insights/). Rebase
  // any relative URL against `currentUrl` so images / cross-doc links
  // resolve on the VKB-served file tree.
  const baseUrl = currentUrl.substring(0, currentUrl.lastIndexOf('/') + 1)
  const urlTransform = useCallback((raw: string): string => {
    if (!raw) return raw
    // Already absolute, protocol-relative, root-relative, or in-page anchor.
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(raw)) return raw
    try {
      return new URL(raw, baseUrl).href
    } catch {
      return raw
    }
  }, [baseUrl])

  // Navigate to a new doc, pushing the current URL onto the back stack.
  const navigateTo = useCallback((next: string) => {
    setHistory((h) => [...h, currentUrl])
    setCurrentUrl(next)
  }, [currentUrl])

  const goBack = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h
      const prev = h[h.length - 1]
      setCurrentUrl(prev)
      return h.slice(0, -1)
    })
  }, [])

  // Custom <a> renderer for ReactMarkdown. Intercepts same-origin .md
  // links so they update the modal in place instead of navigating the
  // host page. Anything else (external links, non-.md URLs, images
  // sitting inside anchors) gets the default new-tab behaviour.
  const AnchorComponent = (
    props: AnchorHTMLAttributes<HTMLAnchorElement>,
  ) => {
    const { href, children, ...rest } = props
    const isInternalMd = (() => {
      if (!href) return false
      try {
        const resolved = new URL(href, baseUrl)
        // Same origin as the doc store + ends in .md → treat as cross-doc.
        const sameOrigin = resolved.origin === new URL(baseUrl).origin
        return sameOrigin && /\.md(?:[?#]|$)/i.test(resolved.pathname)
      } catch {
        return false
      }
    })()

    const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
      if (!isInternalMd || !href) return
      // Let the user open in a new tab via cmd/ctrl-click as a courtesy.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return
      e.preventDefault()
      navigateTo(href)
    }

    return (
      <a
        {...rest}
        href={href}
        onClick={onClick}
        target={isInternalMd ? undefined : '_blank'}
        rel={isInternalMd ? undefined : 'noopener noreferrer'}
      >
        {children}
      </a>
    )
  }

  // Derive a display title from the current URL filename so it updates
  // as the user navigates. Falls back to the prop on the initial doc.
  const displayTitle = currentUrl === url
    ? title
    : decodeURIComponent(currentUrl.substring(currentUrl.lastIndexOf('/') + 1))

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={displayTitle}
      data-testid="insight-document-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        // Click on backdrop closes; click inside the panel doesn't.
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-lg bg-card shadow-xl border border-border">
        <div className="flex items-center justify-between px-4 py-2 border-b border-border gap-2">
          <div className="flex items-center gap-1 min-w-0 flex-1">
            {history.length > 0 && (
              <button
                type="button"
                onClick={goBack}
                aria-label="Back"
                data-testid="insight-doc-back"
                className="h-7 w-7 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground flex items-center justify-center flex-shrink-0"
                title="Back"
              >
                <span aria-hidden className="text-base leading-none">←</span>
              </button>
            )}
            <h2
              className="text-sm font-medium text-foreground truncate"
              title={currentUrl}
            >
              {displayTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close document"
            className="h-7 w-7 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground flex items-center justify-center flex-shrink-0"
          >
            <span aria-hidden className="text-base leading-none">×</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading && (
            <div className="text-sm text-muted-foreground italic">Loading…</div>
          )}
          {isError && (
            <div className="text-sm text-destructive">
              Failed to load <span className="font-mono">{currentUrl}</span>. The file may not exist.
            </div>
          )}
          {!isLoading && !isError && (
            <article className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                urlTransform={urlTransform}
                components={{ a: AnchorComponent }}
              >
                {sanitized}
              </ReactMarkdown>
            </article>
          )}
        </div>
      </div>
    </div>
  )
}
