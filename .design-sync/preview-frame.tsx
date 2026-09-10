// Shared by every authored preview. The card page paints a white body, but the app's tokens
// are dark-first (index.css `:root`), so a bare component renders white text on white. Phone
// puts each cell inside what the app actually is: a dark `#app`-width column. Not a component
// of the design system — a fixture the preview files import.
import React from 'react'

export function Phone({ children, width = 390, pad = 16 }: { children: React.ReactNode; width?: number; pad?: number }) {
  return (
    <div style={{ background: 'var(--bg)', color: 'var(--label)', width, maxWidth: '100%', padding: pad, borderRadius: 18, boxSizing: 'border-box' }}>
      {children}
    </div>
  )
}

// A stack with the app's list rhythm (8px between items).
export function Stack({ children, gap = 8 }: { children: React.ReactNode; gap?: number }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap }}>{children}</div>
}
