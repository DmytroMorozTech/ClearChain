import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
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
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { Download } from 'lucide-react';
import { Link as RouterLink, useSearchParams } from 'react-router';

import { fileUrl } from '../api/client.ts';
import { useCertificates } from '../api/queries.ts';
import { CertificateStatusChip } from '../components/CertificateStatusChip.tsx';
import { FilterBar } from '../components/FilterBar.tsx';
import { InfoNote } from '../components/InfoNote.tsx';
import { RecordCard } from '../components/RecordCard.tsx';
import { CERTIFICATE_LABELS, formatCountdown, formatDate, formatFileSize } from '../format.ts';
import { MOBILE_BREAKPOINT } from '../theme.ts';

/** Owned by the filter bar: counted, and cleared, as one set. */
const FILTER_KEYS = ['status', 'type', 'expiringWithinDays'] as const;

export function CertificatesPage() {
  const [params, setParams] = useSearchParams();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down(MOBILE_BREAKPOINT), { noSsr: true });

  const page = Number(params.get('page') ?? '1');
  const pageSize = Number(params.get('pageSize') ?? '25');

  const { data, isPending, isError, error, isFetching } = useCertificates({
    type: params.get('type') ?? undefined,
    status: params.get('status') ?? undefined,
    expiringWithinDays: params.get('expiringWithinDays')
      ? Number(params.get('expiringWithinDays'))
      : undefined,
    page,
    pageSize,
  });

  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value === '') next.delete(key);
    else next.set(key, value);
    if (key !== 'page') next.delete('page');
    setParams(next);
  }

  return (
    <Stack spacing={2.5}>
      <Stack spacing={0.75}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'baseline' }}>
          <Typography variant="h1">Certificates</Typography>
          {data && <Typography color="text.secondary">{data.total} on file</Typography>}
        </Stack>
        <InfoNote>
          The evidence behind every compliance decision, and when each piece expires.
          Status is worked out from today's date rather than stored, so nothing has to run
          overnight to keep this list accurate.
        </InfoNote>
      </Stack>

      <FilterBar filterKeys={FILTER_KEYS}>
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' },
          }}
        >
          <TextField
            select
            label="Status"
            size="small"
            value={params.get('status') ?? ''}
            onChange={(event) => {
              update('status', event.target.value);
            }}
          >
            <MenuItem value="">Any status</MenuItem>
            <MenuItem value="VALID">Valid</MenuItem>
            <MenuItem value="EXPIRING_SOON">Expiring soon</MenuItem>
            <MenuItem value="EXPIRED">Expired</MenuItem>
          </TextField>

          <TextField
            select
            label="Type"
            size="small"
            value={params.get('type') ?? ''}
            onChange={(event) => {
              update('type', event.target.value);
            }}
          >
            <MenuItem value="">All types</MenuItem>
            {Object.entries(CERTIFICATE_LABELS).map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </TextField>

          {/*
            A separate control from status on purpose: "expiring soon" is a 60-day
            status, while this window is whatever the user picks. Collapsing the two
            would hide that they are different questions.
          */}
          <TextField
            select
            label="Expiring within"
            size="small"
            value={params.get('expiringWithinDays') ?? ''}
            onChange={(event) => {
              update('expiringWithinDays', event.target.value);
            }}
          >
            <MenuItem value="">Any time</MenuItem>
            <MenuItem value="7">7 days</MenuItem>
            <MenuItem value="30">30 days</MenuItem>
            <MenuItem value="60">60 days</MenuItem>
            <MenuItem value="90">90 days</MenuItem>
          </TextField>
        </Box>
      </FilterBar>

      {isError && <Alert severity="error">{error.message}</Alert>}

      <Paper variant="outlined">
        <Box sx={{ height: 4 }}>{isFetching && <LinearProgress />}</Box>

        {isMobile ? (
          <Stack spacing={1.5} sx={{ p: 1.5 }}>
            {isPending && (
              <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                Loading…
              </Typography>
            )}

            {data?.data.length === 0 && (
              <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                No certificate matches these filters.
              </Typography>
            )}

            {data?.data.map((certificate) => (
              <RecordCard
                key={certificate.id}
                title={CERTIFICATE_LABELS[certificate.type]}
                meta={
                  <>
                    <Typography variant="body2" color="text.secondary">
                      <Link
                        component={RouterLink}
                        to={`/suppliers/${certificate.supplier.id}`}
                        underline="hover"
                      >
                        {certificate.supplier.name}
                      </Link>{' '}
                      · tier {certificate.supplier.tier}
                      {certificate.issuer !== null && ` · ${certificate.issuer}`}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Expires {formatDate(certificate.expiryDate)} ·{' '}
                      {formatCountdown(certificate.daysUntilExpiry)}
                    </Typography>
                    {/* On desktop these two live in the download button's tooltip. Touch
                        has no hover, so on mobile the tooltip is the one place they
                        could not be read — they become part of the card instead. */}
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ wordBreak: 'break-all' }}
                    >
                      {certificate.fileName} · {formatFileSize(certificate.fileSize)}
                      {certificate.certificateNumber !== null &&
                        ` · ${certificate.certificateNumber}`}
                    </Typography>
                  </>
                }
                chips={<CertificateStatusChip status={certificate.status} />}
                action={
                  <IconButton
                    component="a"
                    href={fileUrl(certificate.id)}
                    aria-label={`Download ${certificate.fileName}`}
                  >
                    <Download size={18} />
                  </IconButton>
                }
              />
            ))}
          </Stack>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Type</TableCell>
                  <TableCell>Supplier</TableCell>
                  <TableCell>Issuer</TableCell>
                  <TableCell>Expires</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell align="right">File</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {isPending && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                        Loading…
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}

                {data?.data.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                        No certificate matches these filters.
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}

                {data?.data.map((certificate) => (
                  <TableRow key={certificate.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>
                      {CERTIFICATE_LABELS[certificate.type]}
                      {certificate.certificateNumber && (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: 'block' }}
                        >
                          {certificate.certificateNumber}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link
                        component={RouterLink}
                        to={`/suppliers/${certificate.supplier.id}`}
                        underline="hover"
                      >
                        {certificate.supplier.name}
                      </Link>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block' }}
                      >
                        tier {certificate.supplier.tier}
                      </Typography>
                    </TableCell>
                    <TableCell>{certificate.issuer ?? '—'}</TableCell>
                    <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatDate(certificate.expiryDate)}
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: 'block' }}
                      >
                        {formatCountdown(certificate.daysUntilExpiry)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <CertificateStatusChip status={certificate.status} />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip
                        title={`${certificate.fileName} · ${formatFileSize(certificate.fileSize)}`}
                      >
                        <IconButton
                          size="small"
                          component="a"
                          href={fileUrl(certificate.id)}
                          aria-label={`Download ${certificate.fileName}`}
                        >
                          <Download size={16} />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        <TablePagination
          component="div"
          count={data?.total ?? 0}
          page={page - 1}
          onPageChange={(_event, nextPage) => {
            update('page', String(nextPage + 1));
          }}
          rowsPerPage={pageSize}
          rowsPerPageOptions={isMobile ? [] : [25, 50, 100]}
          onRowsPerPageChange={(event) => {
            update('pageSize', event.target.value);
          }}
          sx={{ '& .MuiTablePagination-toolbar': { px: { xs: 1, md: 2 } } }}
        />
      </Paper>
    </Stack>
  );
}
