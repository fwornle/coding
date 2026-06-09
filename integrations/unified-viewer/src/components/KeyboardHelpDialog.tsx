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

// UI-SPEC § Keyboard table (lines 195-204) + 55-UI-SPEC § 10 (Phase 55 row extension).
// NOTE: This dialog only DOCUMENTS shortcuts; binding the keys is the
// responsibility of the consuming surface:
//   - `/`, `Esc`, `Tab/Shift+Tab`, `f`, `?` — useKeyboardShortcuts hook (Phase 45)
//   - `m`               — UnifiedViewer.tsx (Plan 55-07 Task 2)
//   - `t`               — Plan 55-12 (EtmTailSheet trigger)
//   - `1 / 2 / 3 / 4`   — Plan 55-09 (EntityDetailPanel sub-tabs)
//   - `[` / `]`         — preserved Phase 45 collapse semantic (extended hook)
//   - `g then h`        — Plan 55-11 (HierarchyNavigator focus)
//   - `Shift+/`         — Phase 45 `?` is the canonical binding; Shift+/ documented
//                         for keyboards where `?` requires the modifier explicitly.
const SHORTCUTS: ReadonlyArray<ShortcutRow> = [
  // Phase 45 baseline — DO NOT remove or modify (verbatim per UI-SPEC § Copywriting).
  { keys: '/', description: 'Focus the search input' },
  { keys: 'Esc', description: 'Blur search, close dialog, or deselect node' },
  { keys: 'Tab / Shift+Tab', description: 'Roving focus across NavBar, filters, canvas, side panel' },
  { keys: 'Enter', description: 'Activate focused node (same as click)' },
  { keys: 'Space', description: 'Expand neighbors of focused node (same as double-click)' },
  { keys: 'f', description: 'Toggle filter rail collapse' },
  { keys: '?', description: 'Open this keyboard shortcuts dialog' },
  // Phase 55 additions — verbatim from 55-UI-SPEC § 10.
  { keys: 'm', description: 'Toggle Knowledge Graph / Issue Triage mode' },
  { keys: 't', description: 'Open ETM live tail sheet (coding only)' },
  { keys: '1 / 2 / 3 / 4', description: 'Cycle Entity sub-tabs (Default / Evolution / Confidence / Timeline)' },
  { keys: '[ / ]', description: 'Collapse / expand the entire FilterRail' },
  { keys: 'g then h', description: '"Go to hierarchy" — focuses Hierarchy Navigator search (coding only)' },
  { keys: 'Shift+/', description: 'Open keyboard help (same as ?)' },
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
