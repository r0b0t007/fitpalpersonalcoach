import { describe, it, expect } from 'vitest'
import { latestUnread, notesOn, unreadCount } from './notes.js'

// A coach's notes (CHW-340): which belong to what, and what the client has not read yet.
const notes = [
  { id: 'n3', refType: 'workout', refKey: 'w1', body: 'Belle séance', created: 30, readAt: null },
  { id: 'n1', refType: 'checkin', refKey: '2026-11-01', body: 'Bien joué', created: 10, readAt: 15 },
  { id: 'n2', refType: 'checkin', refKey: '2026-11-01', body: 'Et le sommeil ?', created: 20, readAt: null },
]

describe('notes', () => {
  it('threads the notes on one check-in or workout, oldest first', () => {
    expect(notesOn(notes, 'checkin', '2026-11-01').map(n => n.id)).toEqual(['n1', 'n2'])
    expect(notesOn(notes, 'workout', 'w1').map(n => n.id)).toEqual(['n3'])
    expect(notesOn(notes, 'workout', '2026-11-01')).toEqual([])   // a date is a check-in's key, not a workout's
    expect(notesOn(null, 'checkin', 'x')).toEqual([])
  })

  it('counts the unread, and finds the newest of them for Home', () => {
    expect(unreadCount(notes)).toBe(2)
    expect(latestUnread(notes).id).toBe('n3')
    const read = notes.map(n => ({ ...n, readAt: 99 }))
    expect(unreadCount(read)).toBe(0)
    expect(latestUnread(read)).toBe(null)
    expect(latestUnread(undefined)).toBe(null)
  })
})
