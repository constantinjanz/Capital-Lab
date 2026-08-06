import type { LucideIcon } from 'lucide-react'

export function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon
  title: string
  description: string
}) {
  return (
    <div className="empty-state">
      <Icon size={22} aria-hidden="true" />
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  )
}
