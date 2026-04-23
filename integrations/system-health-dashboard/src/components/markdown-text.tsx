import { Fragment } from 'react'

/**
 * Lightweight markdown renderer for observation summaries/insights.
 * Handles: bullet lists, inline code (`backticks`), bold (**text**), line breaks.
 */

function renderInline(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = []
  // Match `code` and **bold** patterns
  const regex = /(`[^`]+`|\*\*[^*]+\*\*)/g
  let last = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index))
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
    parts.push(text.slice(last))
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
      <ul key={`list-${listKey}`} className="list-disc list-inside space-y-0.5 my-1">
        {listItems.map((item, i) => (
          <li key={i} className="text-sm text-muted-foreground leading-relaxed">
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
