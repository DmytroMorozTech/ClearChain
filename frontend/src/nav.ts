import { FileCheck, Factory, LayoutDashboard, Network } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  /** Used by the desktop bar, where there is room for the full name. */
  label: string;
  /** Used by the bottom bar, where four labels share the screen width. */
  shortLabel: string;
  icon: LucideIcon;
  /** `NavLink`'s exact-match flag — only the dashboard needs it, being at `/`. */
  end: boolean;
}

/**
 * The app's destinations, in one place because two navigations render them.
 *
 * They live here rather than in either component so that neither has to import the
 * other: the layout owns the desktop bar and mounts the mobile one, and a shared module
 * is what keeps that from becoming a cycle.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Dashboard', shortLabel: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/suppliers', label: 'Suppliers', shortLabel: 'Suppliers', icon: Factory, end: false },
  { to: '/chain', label: 'Supply chain', shortLabel: 'Chain', icon: Network, end: false },
  {
    to: '/certificates',
    label: 'Certificates',
    shortLabel: 'Certificates',
    icon: FileCheck,
    end: false,
  },
];

/**
 * Which destination a path belongs to, for highlighting.
 *
 * Matching is by prefix, not equality, because `/suppliers/:id` is still the suppliers
 * section — a detail page that lit nothing would read as having navigated out of the
 * app. `/` is checked separately since every path is prefixed by it.
 *
 * Returns `false` for a path that belongs to no destination (the 404 route), which is
 * the value `BottomNavigation` reads as "nothing selected".
 */
export function activeDestination(pathname: string): string | false {
  if (pathname === '/') return '/';
  return NAV_ITEMS.find((item) => item.to !== '/' && pathname.startsWith(item.to))?.to ?? false;
}
