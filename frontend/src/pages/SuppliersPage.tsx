import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { Check, X } from 'lucide-react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router';

import { useCountries, useSuppliers } from '../api/queries.ts';
import { FilterBar } from '../components/FilterBar.tsx';
import { RecordCard } from '../components/RecordCard.tsx';
import { RiskChip } from '../components/RiskChip.tsx';
import { CATEGORY_LABELS } from '../format.ts';
import { MOBILE_BREAKPOINT } from '../theme.ts';

type SortField = 'name' | 'tier' | 'riskScore';

/**
 * The card list has no column headers, so it has nowhere to hang a sort control — the
 * same orderings are offered as a select instead. Losing sort on mobile would have been
 * a functional regression, not a layout compromise.
 */
const SORT_OPTIONS = [
  { value: 'name:asc', label: 'Name A–Z' },
  { value: 'name:desc', label: 'Name Z–A' },
  { value: 'riskScore:desc', label: 'Risk, highest first' },
  { value: 'riskScore:asc', label: 'Risk, lowest first' },
  { value: 'tier:asc', label: 'Tier, nearest first' },
  { value: 'tier:desc', label: 'Tier, furthest first' },
] as const;

/** Owned by the filter bar: counted, and cleared, as one set. */
const FILTER_KEYS = [
  'search',
  'tier',
  'riskLevel',
  'countryCode',
  'category',
  'compliant',
] as const;

/**
 * Filters live in the URL rather than in component state.
 *
 * A filtered view is then a link: it survives a reload, works with the back button, and
 * can be pasted to a colleague. Holding the same state in `useState` would lose all
 * three for no less code.
 */
export function SuppliersPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const countries = useCountries();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down(MOBILE_BREAKPOINT), { noSsr: true });

  const page = Number(params.get('page') ?? '1');
  const pageSize = Number(params.get('pageSize') ?? '25');
  const sort = params.get('sort') ?? 'name:asc';
  const [sortField, sortDirection] = sort.split(':') as [SortField, 'asc' | 'desc'];

  const query = {
    search: params.get('search') ?? undefined,
    tier: params.get('tier') ? Number(params.get('tier')) : undefined,
    riskLevel: params.get('riskLevel') ?? undefined,
    countryCode: params.get('countryCode') ?? undefined,
    category: params.get('category') ?? undefined,
    compliant: params.get('compliant') ? params.get('compliant') === 'true' : undefined,
    page,
    pageSize,
    sort,
  };

  const { data, isPending, isError, error, isFetching } = useSuppliers(query);

  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value === '') next.delete(key);
    else next.set(key, value);
    // Any filter change invalidates the current page number.
    if (key !== 'page') next.delete('page');
    setParams(next);
  }

  function toggleSort(field: SortField) {
    const direction = sortField === field && sortDirection === 'asc' ? 'desc' : 'asc';
    update('sort', `${field}:${direction}`);
  }

  const activeFilters = FILTER_KEYS.filter((key) => params.get(key)).length;

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'baseline' }}>
        <Typography variant="h1">Suppliers</Typography>
        {data && (
          <Typography color="text.secondary">
            {data.total} {data.total === 1 ? 'supplier' : 'suppliers'}
            {activeFilters > 0 ? ' matching' : ''}
          </Typography>
        )}
      </Stack>

      <FilterBar filterKeys={FILTER_KEYS}>
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: 'repeat(6, 1fr)' },
          }}
        >
          <TextField
            label="Search by name"
            size="small"
            value={params.get('search') ?? ''}
            onChange={(event) => {
              update('search', event.target.value);
            }}
          />
          <TextField
            select
            label="Tier"
            size="small"
            value={params.get('tier') ?? ''}
            onChange={(event) => {
              update('tier', event.target.value);
            }}
          >
            <MenuItem value="">All tiers</MenuItem>
            <MenuItem value="1">Tier 1 — direct</MenuItem>
            <MenuItem value="2">Tier 2 — sub-supplier</MenuItem>
            <MenuItem value="3">Tier 3 — raw material</MenuItem>
          </TextField>
          <TextField
            select
            label="Risk"
            size="small"
            value={params.get('riskLevel') ?? ''}
            onChange={(event) => {
              update('riskLevel', event.target.value);
            }}
          >
            <MenuItem value="">Any risk</MenuItem>
            <MenuItem value="GREEN">Low</MenuItem>
            <MenuItem value="YELLOW">Medium</MenuItem>
            <MenuItem value="RED">High</MenuItem>
          </TextField>
          <TextField
            select
            label="Country"
            size="small"
            value={params.get('countryCode') ?? ''}
            onChange={(event) => {
              update('countryCode', event.target.value);
            }}
          >
            <MenuItem value="">All countries</MenuItem>
            {(countries.data?.data ?? []).map((country) => (
              <MenuItem key={country.code} value={country.code}>
                {country.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Category"
            size="small"
            value={params.get('category') ?? ''}
            onChange={(event) => {
              update('category', event.target.value);
            }}
          >
            <MenuItem value="">All categories</MenuItem>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Compliance"
            size="small"
            value={params.get('compliant') ?? ''}
            onChange={(event) => {
              update('compliant', event.target.value);
            }}
          >
            <MenuItem value="">Any</MenuItem>
            <MenuItem value="true">Compliant</MenuItem>
            <MenuItem value="false">Not compliant</MenuItem>
          </TextField>
        </Box>
      </FilterBar>

      {isError && <Alert severity="error">{error.message}</Alert>}

      <Paper variant="outlined">
        <Box sx={{ height: 4 }}>{isFetching && <LinearProgress />}</Box>

        {isMobile ? (
          <Stack spacing={1.5} sx={{ p: 1.5 }}>
            <TextField
              select
              label="Sort by"
              size="small"
              value={sort}
              onChange={(event) => {
                update('sort', event.target.value);
              }}
            >
              {SORT_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>

            {isPending && (
              <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                Loading…
              </Typography>
            )}

            {data?.data.length === 0 && (
              <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                No supplier matches these filters.
              </Typography>
            )}

            {data?.data.map((supplier) => (
              <RecordCard
                key={supplier.id}
                to={`/suppliers/${supplier.id}`}
                title={supplier.name}
                meta={
                  <Typography variant="body2" color="text.secondary">
                    {supplier.country?.name ?? supplier.countryCode} · Tier {supplier.tier} ·{' '}
                    {CATEGORY_LABELS[supplier.category]}
                  </Typography>
                }
                chips={
                  <>
                    <RiskChip level={supplier.riskLevel} score={supplier.riskScore} />
                    {supplier.isCompliant ? (
                      <Chip
                        size="small"
                        variant="outlined"
                        color="success"
                        icon={<Check size={14} />}
                        label="Compliant"
                      />
                    ) : (
                      <Chip
                        size="small"
                        variant="outlined"
                        color="default"
                        icon={<X size={14} />}
                        label="Not compliant"
                      />
                    )}
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`${String(supplier.certificateCount)} ${
                        supplier.certificateCount === 1 ? 'certificate' : 'certificates'
                      }`}
                    />
                  </>
                }
              />
            ))}
          </Stack>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sortDirection={sortField === 'name' ? sortDirection : false}>
                    <TableSortLabel
                      active={sortField === 'name'}
                      direction={sortField === 'name' ? sortDirection : 'asc'}
                      onClick={() => {
                        toggleSort('name');
                      }}
                    >
                      Supplier
                    </TableSortLabel>
                  </TableCell>
                  <TableCell>Country</TableCell>
                  <TableCell>
                    <TableSortLabel
                      active={sortField === 'tier'}
                      direction={sortField === 'tier' ? sortDirection : 'asc'}
                      onClick={() => {
                        toggleSort('tier');
                      }}
                    >
                      Tier
                    </TableSortLabel>
                  </TableCell>
                  <TableCell>Category</TableCell>
                  <TableCell>
                    <TableSortLabel
                      active={sortField === 'riskScore'}
                      direction={sortField === 'riskScore' ? sortDirection : 'asc'}
                      onClick={() => {
                        toggleSort('riskScore');
                      }}
                    >
                      Risk
                    </TableSortLabel>
                  </TableCell>
                  <TableCell>Compliant</TableCell>
                  <TableCell align="right">Certificates</TableCell>
                </TableRow>
              </TableHead>

              <TableBody>
                {isPending && (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                        Loading…
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}

                {data?.data.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                        No supplier matches these filters.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}

                {data?.data.map((supplier) => (
                  <TableRow
                    key={supplier.id}
                    hover
                    onClick={() => {
                      void navigate(`/suppliers/${supplier.id}`);
                    }}
                    sx={{ cursor: 'pointer' }}
                  >
                    {/* A real link, not just a clickable row: it restores keyboard access,
                      middle-click and open-in-new-tab, which the row handler alone cannot
                      offer. The anchor sits on the cell because a `TableRow` rendered as
                      an anchor is invalid table markup. */}
                    <TableCell sx={{ fontWeight: 600 }}>
                      <Link
                        component={RouterLink}
                        to={`/suppliers/${supplier.id}`}
                        underline="hover"
                        color="inherit"
                        onClick={(event) => {
                          event.stopPropagation();
                        }}
                      >
                        {supplier.name}
                      </Link>
                    </TableCell>
                    <TableCell>{supplier.country?.name ?? supplier.countryCode}</TableCell>
                    <TableCell>{supplier.tier}</TableCell>
                    <TableCell>{CATEGORY_LABELS[supplier.category]}</TableCell>
                    <TableCell>
                      <RiskChip level={supplier.riskLevel} score={supplier.riskScore} />
                    </TableCell>
                    <TableCell>
                      {supplier.isCompliant ? (
                        <Chip
                          size="small"
                          variant="outlined"
                          color="success"
                          icon={<Check size={14} />}
                          label="Yes"
                        />
                      ) : (
                        <Chip
                          size="small"
                          variant="outlined"
                          color="default"
                          icon={<X size={14} />}
                          label="No"
                        />
                      )}
                    </TableCell>
                    <TableCell align="right">{supplier.certificateCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {/* An empty `rowsPerPageOptions` drops the page-size select entirely, which is
            what stops the pagination toolbar overflowing below ~400px. */}
        <TablePagination
          component="div"
          count={data?.total ?? 0}
          page={page - 1}
          onPageChange={(_event, nextPage) => {
            update('page', String(nextPage + 1));
          }}
          rowsPerPage={pageSize}
          rowsPerPageOptions={isMobile ? [] : [10, 25, 50, 100]}
          onRowsPerPageChange={(event) => {
            update('pageSize', event.target.value);
          }}
          sx={{ '& .MuiTablePagination-toolbar': { px: { xs: 1, md: 2 } } }}
        />
      </Paper>
    </Stack>
  );
}
