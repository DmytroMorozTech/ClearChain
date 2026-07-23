import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { FilterX } from 'lucide-react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';

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
 */
export function FilterBar({ filterKeys, children }: FilterBarProps) {
  const [params, setParams] = useSearchParams();
  const activeCount = filterKeys.filter((key) => params.get(key)).length;

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
        spacing={2}
        sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          {activeCount === 0
            ? 'Filters'
            : `${String(activeCount)} ${activeCount === 1 ? 'filter' : 'filters'} active`}
        </Typography>

        {/* Rendered even with nothing to clear, and disabled instead of hidden: the row
            keeps its height, so applying a filter does not shift the controls below. */}
        <Button
          size="small"
          startIcon={<FilterX size={15} />}
          onClick={clearAll}
          disabled={activeCount === 0}
        >
          Clear all filters
        </Button>
      </Stack>

      <Box>{children}</Box>
    </Paper>
  );
}
