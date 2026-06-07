// PATTERN SOURCE: 45-UI-SPEC.md § Keyboard table + § Copywriting Contract
//
// Radix Dialog wrapping the 7-row shortcut table. Header copy verbatim
// from UI-SPEC ("Keyboard shortcuts" / "Close"). Controlled-component
// pattern — the App or ViewerCore owns the `open` state and the `?`
// shortcut flips it.

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export interface KeyboardHelpDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface ShortcutRow {
  keys: string
  description: string
}

// UI-SPEC § Keyboard table (lines 195-204).
const SHORTCUTS: ReadonlyArray<ShortcutRow> = [
  { keys: '/', description: 'Focus the search input' },
  { keys: 'Esc', description: 'Blur search, close dialog, or deselect node' },
  { keys: 'Tab / Shift+Tab', description: 'Roving focus across NavBar, filters, canvas, side panel' },
  { keys: 'Enter', description: 'Activate focused node (same as click)' },
  { keys: 'Space', description: 'Expand neighbors of focused node (same as double-click)' },
  { keys: 'f', description: 'Toggle filter rail collapse' },
  { keys: '?', description: 'Open this keyboard shortcuts dialog' },
]

export function KeyboardHelpDialog({ open, onOpenChange }: KeyboardHelpDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="keyboard-help-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Tap any key combination while the viewer has focus.
          </DialogDescription>
        </DialogHeader>
        <table className="w-full text-sm" data-testid="keyboard-shortcuts-table">
          <tbody>
            {SHORTCUTS.map(({ keys, description }) => (
              <tr key={keys} className="border-t border-border first:border-t-0">
                <td className="py-2 pr-4 font-mono text-xs text-foreground">
                  <kbd className="rounded-md border border-border bg-muted px-2 py-0.5">{keys}</kbd>
                </td>
                <td className="py-2 text-muted-foreground">{description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
