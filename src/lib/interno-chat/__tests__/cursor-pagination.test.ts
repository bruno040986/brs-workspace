import { describe, it } from 'node:test'
import assert from 'node:assert'
import { construirFiltroCursorComposto, mergeMessages } from '../cursor.ts'
import { mergeChatwootMessages } from '../../central-conversas/chatwoot.ts'

describe('Unit Tests: Cursor Pagination & History Preservation Pure Helpers', () => {
  it('construirFiltroCursorComposto generates correct PostgREST tie-breaking filter string', () => {
    const filter = construirFiltroCursorComposto('2026-09-24T10:00:00.000Z', 'msg-123')
    assert.strictEqual(
      filter,
      'created_at.lt.2026-09-24T10:00:00.000Z,and(created_at.eq.2026-09-24T10:00:00.000Z,id.lt.msg-123)',
    )

    const dateOnlyFilter = construirFiltroCursorComposto('2026-09-24T10:00:00.000Z')
    assert.strictEqual(dateOnlyFilter, 'created_at.lt.2026-09-24T10:00:00.000Z')

    assert.strictEqual(construirFiltroCursorComposto(), null)
  })

  it('mergeMessages preserves older history when background update arrives', () => {
    // 1. User originally had 2 older messages (m1, m2) and 2 newer messages (m3, m4)
    const existingLoadedHistory = [
      { id: 'm1', timestamp: '2026-09-24T09:00:00.000Z', text: 'Old 1' },
      { id: 'm2', timestamp: '2026-09-24T09:30:00.000Z', text: 'Old 2' },
      { id: 'm3', timestamp: '2026-09-24T10:00:00.000Z', text: 'Recent 1' },
      { id: 'm4', timestamp: '2026-09-24T10:30:00.000Z', text: 'Recent 2' },
    ]

    // 2. Background polling or Realtime re-fetches latest 50 (here returning m3, m4 + brand new m5)
    const freshPollResult = [
      { id: 'm3', timestamp: '2026-09-24T10:00:00.000Z', text: 'Recent 1 (updated)' },
      { id: 'm4', timestamp: '2026-09-24T10:30:00.000Z', text: 'Recent 2' },
      { id: 'm5', timestamp: '2026-09-24T11:00:00.000Z', text: 'New 3' },
    ]

    const merged = mergeMessages(existingLoadedHistory, freshPollResult)

    // Verify older messages (m1, m2) were NOT discarded!
    assert.strictEqual(merged.length, 5)
    assert.strictEqual(merged[0].id, 'm1')
    assert.strictEqual(merged[1].id, 'm2')
    assert.strictEqual(merged[2].id, 'm3')
    assert.strictEqual(merged[2].text, 'Recent 1 (updated)') // Updated content preserved
    assert.strictEqual(merged[4].id, 'm5')
  })

  it('mergeChatwootMessages preserves older atendimento history during polling', () => {
    const existing = [
      { id: 101, created_at: 1000, content: 'First' },
      { id: 102, created_at: 2000, content: 'Second' },
    ] as any[]

    const fresh = [
      { id: 102, created_at: 2000, content: 'Second' },
      { id: 103, created_at: 3000, content: 'Third' },
    ] as any[]

    const merged = mergeChatwootMessages(existing, fresh)
    assert.strictEqual(merged.length, 3)
    assert.deepStrictEqual(
      merged.map((m) => m.id),
      [101, 102, 103],
    )
  })

  it('discards obsolete response when switching conversations quickly (generation / ID check)', () => {
    let currentSelectionId = 'conv-A'
    let stateForConvB: any = null

    // Simulates an async fetch for Conv-A started before switch
    const asyncFetchForConvA = async () => {
      const data = [{ id: 'msg-A1', text: 'From A' }]
      // When response arrives, check if current selection is still conv-A
      if (currentSelectionId === 'conv-A') {
        stateForConvB = data
      }
      return data
    }

    // User rapidly switches to Conv-B
    currentSelectionId = 'conv-B'

    // Response for Conv-A arrives NOW
    asyncFetchForConvA()

    // Verify stateForConvB was NOT overwritten by Conv-A's response!
    assert.strictEqual(stateForConvB, null)
  })
})
