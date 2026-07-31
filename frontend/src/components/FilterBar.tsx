import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { ChevronDown, FilterX, SlidersHorizontal } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useSearchParams } from 'react-router';

import { MOBILE_BREAKPOINT } from '../theme.ts';

interface FilterBarProps {
  /**
   * The query-string keys this bar owns. They are counted together and cleared
   * together, so a page cannot drift out of step with its own clear button.
   */
  filterKeys: readonly string[];
  /** The controls themselves; laid out by the page, since column counts differ. */
  children: ReactNode;
}

/**
 * One filter row above everything it scopes, on every screen that filters.
 *
 * Both filtering screens share this component rather than each drawing their own
 * header, which is what makes the clear button sit in the same place — guaranteed by
 * construction instead of by remembering.
 *
 * Sorting and page size are deliberately left alone. They describe how the reader wants
 * to look at the data, not which rows they asked for, and wiping them would be a
 * surprise the label does not promise.
 *
 * Below `md` the controls collapse. Stacked one per row, six filters push the first
 * result off a phone screen entirely — so the bar opens only if it is already doing
 * something, and the count it was already computing becomes the summary of what is
 * hidden. Above `md` there is room for all of them and the panel never closes; a
 * disclosure the user cannot benefit from is just a click in the way.
 */
export function FilterBar({ filterKeys, children }: FilterBarProps) {
  const [params, setParams] = useSearchParams();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down(MOBILE_BREAKPOINT), { noSsr: true });

  const activeCount = filterKeys.filter((key) => params.get(key)).length;

  // Seeded once, from the filters the URL arrived with: a shared link that carries
  // filters should show them, and one that does not should lead with the results.
  // Deliberately not kept in sync afterwards — reopening the panel under someone who
  // just collapsed it would be the component arguing with the user.
  const [open, setOpen] = useState(activeCount > 0);

  const summary =
    activeCount === 0
      ? 'Filters'
      : `${String(activeCount)} ${activeCount === 1 ? 'filter' : 'filters'} active`;

  function clearAll() {
    const next = new URLSearchParams(params);
    for (const key of filterKeys) next.delete(key);
    // Page 1 of the unfiltered set: staying on page 4 of a list that just grew is
    // disorienting, and may be past its end.
    next.delete('page');
    setParams(next);
  }

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ justifyContent: 'space-between', alignItems: 'center' }}
      >
        {isMobile ? (
          <Button
            size="small"
            onClick={() => {
              setOpen((current) => !current);
            }}
            aria-expanded={open}
            startIcon={<SlidersHorizontal size={15} />}
            endIcon={
              <ChevronDown
                size={15}
                style={{
                  transform: open ? 'rotate(180deg)' : 'none',
                  transition: 'transform 150ms',
                }}
              />
            }
            sx={{ color: 'text.secondary', ml: -1 }}
          >
            {summary}
          </Button>
        ) : (
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            {summary}
          </Typography>
        )}

        {/* Rendered even with nothing to clear, and disabled instead of hidden: the row
            keeps its height, so applying a filter does not shift the controls below. */}
        <Button
          size="small"
          startIcon={<FilterX size={15} />}
          onClick={clearAll}
          disabled={activeCount === 0}
        >
          {isMobile ? 'Clear' : 'Clear all filters'}
        </Button>
      </Stack>

      {/* The gap belongs to the controls, not the header — left on the header it would
          hang below the row whenever the panel is closed. */}
      <Collapse in={!isMobile || open}>
        <Box sx={{ mt: 1.5 }}>{children}</Box>
      </Collapse>
    </Paper>
  );
}
