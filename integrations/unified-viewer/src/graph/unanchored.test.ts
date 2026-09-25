import { describe, it, expect } from 'vitest'
import { countUnanchored } from './unanchored'

describe('countUnanchored', () => {
  const classes = new Map<string, string>([
    ['sys', 'System'],
    ['proj', 'Project'],
    ['comp', 'Component'],
    ['sub', 'SubComponent'],
    ['det', 'Detail'],
    ['loose', 'Detail'],
    ['a', 'Detail'],
    ['b', 'Detail'],
  ])
  const classOf = (id: string) => classes.get(id)

  it('counts a row with no parent at all', () => {
    expect(countUnanchored(['loose'], new Map(), classOf)).toBe(1)
  })

  it('does not count a row that reaches a Project', () => {
    const parents = new Map([
      ['det', 'sub'],
      ['sub', 'comp'],
      ['comp', 'proj'],
    ])
    expect(countUnanchored(['det'], parents, classOf)).toBe(0)
  })

  it('does not count the roots themselves', () => {
    expect(countUnanchored(['proj', 'sys'], new Map(), classOf)).toBe(0)
  })

  it('counts a chain that never reaches a root', () => {
    // comp -> sub -> (nothing). A real shape: an extraction artifact never
    // attached to a Project.
    const parents = new Map([
      ['det', 'sub'],
      ['sub', 'comp'],
    ])
    expect(countUnanchored(['det'], parents, classOf)).toBe(1)
  })

  it('terminates on a cycle instead of hanging', () => {
    const parents = new Map([
      ['a', 'b'],
      ['b', 'a'],
    ])
    expect(countUnanchored(['a', 'b'], parents, classOf)).toBe(2)
  })

  it('reaching a System counts as rooted', () => {
    expect(countUnanchored(['proj2'], new Map([['proj2', 'sys']]), (id) =>
      id === 'sys' ? 'System' : 'Project',
    )).toBe(0)
  })
})
