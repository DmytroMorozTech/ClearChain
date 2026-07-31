import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import Paper from '@mui/material/Paper';
import { Link, useLocation } from 'react-router';

import { NAV_ITEMS, activeDestination } from '../nav.ts';

/**
 * The bar's own height, excluding the safe-area inset. The layout adds both to its
 * bottom padding so the last row of a list is not sitting underneath the bar.
 */
export const BOTTOM_NAV_HEIGHT = 56;

/**
 * Primary navigation below `md`.
 *
 * Four destinations is the count a bottom bar is for: every screen is one thumb-reach
 * away, and none of them is hidden behind a menu the way a drawer would hide them. The
 * desktop bar in `AppLayout` renders the same items from the same list.
 */
export function MobileNav() {
  const { pathname } = useLocation();

  return (
    <Paper
      elevation={0}
      square
      sx={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: (theme) => theme.zIndex.appBar,
        borderTop: 1,
        borderColor: 'divider',
        // Keeps the actions above the home indicator on a notched phone; resolves to
        // zero everywhere else.
        pb: 'env(safe-area-inset-bottom)',
      }}
    >
      <BottomNavigation
        value={activeDestination(pathname)}
        showLabels
        sx={{ height: BOTTOM_NAV_HEIGHT }}
      >
        {NAV_ITEMS.map(({ to, shortLabel, icon: Icon }) => (
          <BottomNavigationAction
            key={to}
            component={Link}
            to={to}
            value={to}
            label={shortLabel}
            icon={<Icon size={21} />}
            sx={{
              minWidth: 0,
              px: 0.5,
              // MUI grows the selected label from 12px to 14px, which reflows all four
              // captions every time the user navigates. Pinned instead — at 11px even
              // "Certificates" fits the 80px action on a 320px screen.
              '& .MuiBottomNavigationAction-label': {
                fontSize: 11,
                whiteSpace: 'nowrap',
                '&.Mui-selected': { fontSize: 11 },
              },
            }}
          />
        ))}
      </BottomNavigation>
    </Paper>
  );
}
