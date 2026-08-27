import Link from 'next/link'

/**
 * The four places the app has, in the order a reader moves through them: what is queued,
 * what is worth reading, what they already know, and what they want next.
 */
const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/episodes', label: 'Episodes' },
  { href: '/knowledge', label: 'Knowledge base' },
  { href: '/settings', label: 'Settings' },
] as const

export function AppNav({ email }: { email: string }) {
  return (
    <nav className="app-nav row-between">
      <ul className="plain row-tight">
        {LINKS.map((link) => (
          <li key={link.href}>
            <Link href={link.href}>{link.label}</Link>
          </li>
        ))}
      </ul>
      <span className="muted">{email}</span>
    </nav>
  )
}
