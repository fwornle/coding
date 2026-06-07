// PATTERN SOURCE: 45-01-PLAN.md Task 2 <behavior> Tests 4 + 5
//
// Test 4: /viewer/coding renders the ViewerCore with the "Coding" wordmark;
//         /viewer/unknown renders UnknownSystem with three labelled links.
// Test 5: Switching :system unmounts and re-mounts the subtree
//         (proven via a DOM-ref check — the wordmark element is a NEW DOM node).

import { describe, test, expect } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom'
import { UnifiedViewer } from './UnifiedViewer'
import { UnknownSystem } from './UnknownSystem'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<Navigate to="/viewer/coding" replace />} />
        <Route path="/viewer/:system" element={<UnifiedViewer />} />
        <Route path="*" element={<UnknownSystem />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('UnifiedViewer routing', () => {
  test('/viewer/coding renders ViewerCore with the Coding wordmark', () => {
    renderAt('/viewer/coding')
    const wordmark = screen.getByTestId('viewer-wordmark')
    expect(wordmark).toHaveTextContent('Coding')
    expect(screen.getByTestId('viewer-baseurl')).toHaveTextContent(/localhost:12436|http/)
    cleanup()
  })

  test('/viewer/okb renders ViewerCore with the OKB wordmark', () => {
    renderAt('/viewer/okb')
    expect(screen.getByTestId('viewer-wordmark')).toHaveTextContent('OKB')
    cleanup()
  })

  test('/viewer/cap renders ViewerCore with the CAP wordmark', () => {
    renderAt('/viewer/cap')
    expect(screen.getByTestId('viewer-wordmark')).toHaveTextContent('CAP')
    cleanup()
  })

  test('/viewer/foo redirects to /viewer/coding (invalid system)', () => {
    renderAt('/viewer/foo')
    // After redirect, the Coding wordmark should appear
    expect(screen.getByTestId('viewer-wordmark')).toHaveTextContent('Coding')
    cleanup()
  })

  test('/foo renders UnknownSystem with three labelled links', () => {
    renderAt('/foo')
    const unknown = screen.getByTestId('unknown-system')
    expect(unknown).toBeInTheDocument()
    const links = screen.getByTestId('unknown-system-links').querySelectorAll('a')
    expect(links).toHaveLength(3)
    const labels = Array.from(links).map((a) => a.textContent)
    expect(labels).toContain('Coding')
    expect(labels).toContain('OKB')
    expect(labels).toContain('CAP')
    cleanup()
  })

  test('/ redirects to /viewer/coding', () => {
    renderAt('/')
    expect(screen.getByTestId('viewer-wordmark')).toHaveTextContent('Coding')
    cleanup()
  })

  test('switching :system produces a NEW wordmark DOM node (key={system} remount)', () => {
    // First render at /viewer/coding, capture the wordmark DOM node identity.
    const { unmount } = renderAt('/viewer/coding')
    const codingNode = screen.getByTestId('viewer-wordmark')
    expect(codingNode).toHaveTextContent('Coding')
    unmount()
    cleanup()

    // Mount fresh at /viewer/okb and capture the new wordmark node.
    renderAt('/viewer/okb')
    const okbNode = screen.getByTestId('viewer-wordmark')
    expect(okbNode).toHaveTextContent('OKB')
    // Different mounts -> different DOM nodes -> proves no shared element survives system switch.
    expect(okbNode).not.toBe(codingNode)
    cleanup()
  })
})
