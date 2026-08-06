import type { ReactNode } from 'react'

export function TableShell({
  caption,
  children,
}: {
  caption: string
  children: ReactNode
}) {
  return (
    <div className="table-shell">
      <table>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  )
}
