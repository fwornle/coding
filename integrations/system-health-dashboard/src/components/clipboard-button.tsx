import { useState, useCallback } from 'react'
import { Copy, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ClipboardButtonProps {
  text: string
  className?: string
  title?: string
}

export function ClipboardButton({ text, className, title = 'Copy to clipboard' }: ClipboardButtonProps) {
  const [done, setDone] = useState(false)

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      e.preventDefault()
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text)
        } else {
          const ta = document.createElement('textarea')
          ta.value = text
          ta.style.position = 'fixed'
          ta.style.opacity = '0'
          document.body.appendChild(ta)
          ta.select()
          document.execCommand('copy')
          document.body.removeChild(ta)
        }
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      } catch {
        /* clipboard blocked — leave icon unchanged */
      }
    },
    [text]
  )

  return (
    <button
      type="button"
      onClick={handleClick}
      title={done ? 'Copied!' : title}
      aria-label={title}
      className={cn(
        'inline-flex items-center justify-center rounded p-1 text-muted-foreground/60 hover:text-foreground hover:bg-accent transition-colors shrink-0',
        className
      )}
    >
      {done ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}
