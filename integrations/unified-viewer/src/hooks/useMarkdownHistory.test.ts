// PATTERN SOURCE: 45-04-PLAN.md Task 2 History Test 1-2
//
// Test 1: pushHistory(a) then pushHistory(b) — currentPath=b, canBack=true,
//         canForward=false. After back(), currentPath=a, canBack=false,
//         canForward=true.
// Test 2: After back() then pushHistory(c), the forward stack is cleared
//         (cannot fork).

import { describe, test, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMarkdownHistory } from './useMarkdownHistory'

describe('useMarkdownHistory (Plan 45-04 Task 2)', () => {
  test('History Test 1: push twice then back walks the stack', () => {
    const { result } = renderHook(() => useMarkdownHistory())

    expect(result.current.currentPath).toBeNull()
    expect(result.current.canBack).toBe(false)
    expect(result.current.canForward).toBe(false)

    act(() => result.current.pushHistory('a.md'))
    expect(result.current.currentPath).toBe('a.md')
    expect(result.current.canBack).toBe(false)
    expect(result.current.canForward).toBe(false)

    act(() => result.current.pushHistory('b.md'))
    expect(result.current.currentPath).toBe('b.md')
    expect(result.current.canBack).toBe(true)
    expect(result.current.canForward).toBe(false)

    act(() => result.current.back())
    expect(result.current.currentPath).toBe('a.md')
    expect(result.current.canBack).toBe(false)
    expect(result.current.canForward).toBe(true)

    // forward() returns to b.md
    act(() => result.current.forward())
    expect(result.current.currentPath).toBe('b.md')
    expect(result.current.canBack).toBe(true)
    expect(result.current.canForward).toBe(false)
  })

  test('History Test 2: pushing after back() truncates the forward stack', () => {
    const { result } = renderHook(() => useMarkdownHistory())

    act(() => result.current.pushHistory('a.md'))
    act(() => result.current.pushHistory('b.md'))
    act(() => result.current.back())
    // Cursor is now on 'a.md'; b.md remains in the forward stack.
    expect(result.current.currentPath).toBe('a.md')
    expect(result.current.canForward).toBe(true)

    // Pushing c.md after back() should CLEAR the b.md forward entry.
    act(() => result.current.pushHistory('c.md'))
    expect(result.current.currentPath).toBe('c.md')
    expect(result.current.canBack).toBe(true)
    expect(result.current.canForward).toBe(false)
    expect(result.current.stackSize).toBe(2) // a, c — b dropped
  })

  test('History Test 2b: back() at cursor=0 is a no-op (no underflow)', () => {
    const { result } = renderHook(() => useMarkdownHistory())
    act(() => result.current.pushHistory('a.md'))
    // cursor=0; back should be a no-op.
    act(() => result.current.back())
    expect(result.current.currentPath).toBe('a.md')
    expect(result.current.cursorIndex).toBe(0)
  })

  test('History Test 2c: forward() at end of stack is a no-op', () => {
    const { result } = renderHook(() => useMarkdownHistory())
    act(() => result.current.pushHistory('a.md'))
    // forward at the tip of the stack — no-op.
    act(() => result.current.forward())
    expect(result.current.currentPath).toBe('a.md')
    expect(result.current.cursorIndex).toBe(0)
  })
})
