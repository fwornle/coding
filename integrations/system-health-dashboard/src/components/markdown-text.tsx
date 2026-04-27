import { Fragment } from 'react'

/**
 * Lightweight markdown renderer for observation summaries/insights.
 * Handles: bullet lists, inline code (`backticks`), bold (**text**), line breaks.
 *
 * Also styles redaction tokens emitted by the LSL pipeline
 * (e.g. <USER_ID_REDACTED>, <AWS_SECRET_REDACTED>) as smaller, light-blue
 * inline spans so paths and sentences containing them stay readable.
 */

const REDACTION_TOKEN_RX = /<[A-Z][A-Z0-9_]*_REDACTED>/g

/**
 * Render a string into React nodes with redaction tokens styled as
 * smaller, light-blue inline spans. Exported so plain-text fields outside
 * the markdown renderer (digests' filesTouched, observation artifacts,
 * etc.) can use the same visual treatment.
 */
export function renderWithRedactionStyling(text: string, keyBase: string = 'r'): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = []
  pushRedactionAware(parts, text, keyBase)
  return parts
}

function pushRedactionAware(parts: (string | JSX.Element)[], text: string, keyBase: string) {
  let last = 0
  let m: RegExpExecArray | null
  REDACTION_TOKEN_RX.lastIndex = 0
  while ((m = REDACTION_TOKEN_RX.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    parts.push(
      <span key={`${keyBase}-r-${m.index}`} className="text-[0.78em] text-sky-400/80">
        {m[0]}
      </span>
    )
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
}

function renderInline(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = []
  // Match `code` and **bold** patterns
  const regex = /(`[^`]+`|\*\*[^*]+\*\*)/g
  let last = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      pushRedactionAware(parts, text.slice(last, match.index), `pre-${match.index}`)
    }
    const token = match[0]
    if (token.startsWith('`')) {
      parts.push(
        <code key={match.index} className="px-1 py-0.5 bg-muted rounded text-xs font-mono">
          {token.slice(1, -1)}
        </code>
      )
    } else if (token.startsWith('**')) {
      parts.push(
        <strong key={match.index} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>
      )
    }
    last = match.index + token.length
  }
  if (last < text.length) {
    pushRedactionAware(parts, text.slice(last), 'tail')
  }
  return parts
}

export function MarkdownText({ text, className = '' }: { text: string; className?: string }) {
  const lines = text.split('\n')
  const elements: JSX.Element[] = []
  let listItems: string[] = []
  let listKey = 0

  function flushList() {
    if (listItems.length === 0) return
    elements.push(
      <ul key={`list-${listKey}`} className="list-disc list-outside pl-5 space-y-0.5 my-1">
        {listItems.map((item, i) => (
          <li key={i} className="text-sm text-muted-foreground leading-relaxed pl-1">
            {renderInline(item)}
          </li>
        ))}
      </ul>
    )
    listItems = []
    listKey++
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const bulletMatch = line.match(/^\s*[-*•]\s+(.+)/)
    const numberedMatch = line.match(/^\s*\d+[.)]\s+(.+)/)

    if (bulletMatch) {
      listItems.push(bulletMatch[1])
    } else if (numberedMatch) {
      listItems.push(numberedMatch[1])
    } else {
      flushList()
      if (line.trim() === '') {
        elements.push(<div key={`br-${i}`} className="h-1" />)
      } else {
        elements.push(
          <p key={`p-${i}`} className="text-sm text-muted-foreground leading-relaxed">
            {renderInline(line)}
          </p>
        )
      }
    }
  }
  flushList()

  return <div className={className}>{elements.map((el, i) => <Fragment key={i}>{el}</Fragment>)}</div>
}
