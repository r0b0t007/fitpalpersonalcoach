// A coach's replies to check-ins and comments on workouts (CHW-340), as the client's app and the
// coach's client page read them. Server-owned (GET /api/notes, the member payload's `notes`),
// never in S: a note would be gone at the next sync from the client's phone.

/** The notes on one check-in (its date) or one workout (its id), oldest first, as a thread reads. */
export const notesOn = (notes, refType, refKey) =>
  (notes || []).filter(n => n.refType === refType && n.refKey === refKey).sort((a, b) => a.created - b.created)

/** How many the client has not read: the dot on the Coach tab. */
export const unreadCount = notes => (notes || []).filter(n => !n.readAt).length

/** The newest note not yet read, for Home; null once all are read. */
export const latestUnread = notes =>
  (notes || []).filter(n => !n.readAt).reduce((a, n) => (!a || n.created > a.created ? n : a), null)
