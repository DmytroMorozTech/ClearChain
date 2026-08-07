import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Breadcrumbs from '@mui/material/Breadcrumbs';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { ArrowLeft, Download, Plus, Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router';

import { fileUrl } from '../api/client.ts';
import { useDeleteCertificate, useSupplier } from '../api/queries.ts';
import type { Requirement, SupplierDetail } from '../api/schemas.ts';
import { CertificateStatusChip } from '../components/CertificateStatusChip.tsx';
import { CertificateUploadDialog } from '../components/CertificateUploadDialog.tsx';
import { ConfirmDialog } from '../components/ConfirmDialog.tsx';
import { NotCompliantChip } from '../components/NotCompliantChip.tsx';
import { RecordCard } from '../components/RecordCard.tsx';
import { RiskBreakdown } from '../components/RiskBreakdown.tsx';
import { RiskChip } from '../components/RiskChip.tsx';
import {
  CATEGORY_LABELS,
  CERTIFICATE_LABELS,
  formatCountdown,
  formatDate,
  formatFileSize,
} from '../format.ts';
import { MOBILE_BREAKPOINT } from '../theme.ts';

/**
 * `wide` gives a field the whole row on a phone. Only the contact address asks for it:
 * an email has no break opportunity, so in a half-width column it either forces the
 * column open or shatters across three lines.
 */
function Field({ label, value, wide }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <Box sx={{ minWidth: 0, gridColumn: wide === true ? { xs: '1 / -1', sm: 'auto' } : undefined }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      {/* `anywhere` rather than `break-word`: the latter still refuses to split a single
          long token, which is exactly what an email address is. */}
      <Typography sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{value}</Typography>
    </Box>
  );
}

/**
 * Requirements reported by exception: badging the satisfied ones too would only repeat
 * the certificate list below, and bury the one badge worth reading among green ticks.
 */
function RequirementSummary({ requirements }: { requirements: readonly Requirement[] }) {
  const outstanding = requirements.filter((requirement) => requirement.status !== 'VALID');

  if (outstanding.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        All {requirements.length} on file and valid.
      </Typography>
    );
  }

  return (
    <Box sx={{ mt: 1.5, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
      {outstanding.map((requirement) => (
        <Chip
          key={requirement.type}
          size="small"
          variant="outlined"
          label={
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
              <span>{CERTIFICATE_LABELS[requirement.type]}</span>
              {/* Spelled out rather than `iconOnly`. The grid could afford a bare glyph
                  because a green tick beside every type needed no elaboration; a badge
                  that only ever appears to report a problem has to name the problem. */}
              <CertificateStatusChip status={requirement.status} />
              {/* Null for a certificate never held — there is no date to count towards. */}
              {requirement.daysUntilExpiry !== null && (
                <Typography variant="caption" color="text.secondary">
                  {formatCountdown(requirement.daysUntilExpiry)}
                </Typography>
              )}
            </Stack>
          }
          sx={{ height: 'auto', py: 0.5, '& .MuiChip-label': { px: 1 } }}
        />
      ))}
    </Box>
  );
}

/**
 * Returns to wherever the reader actually came from, which the breadcrumb cannot do:
 * this page is reached from the supplier list, from the chain map and from another
 * supplier's upstream list, and the breadcrumb only ever describes the hierarchy.
 *
 * React Router stamps an index onto each history entry. An index of 0 means this entry
 * opened the session — a pasted link or a fresh tab — so going back would leave the app
 * entirely; that case falls back to the list instead.
 */
function useGoBack(fallback: string): () => void {
  const navigate = useNavigate();
  const historyIndex = (window.history.state as { idx?: number } | null)?.idx ?? 0;

  return () => {
    void (historyIndex > 0 ? navigate(-1) : navigate(fallback));
  };
}

type CertificateRow = SupplierDetail['certificates'][number];

export function SupplierDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { data, isPending, isError, error } = useSupplier(id);
  const deleteCertificate = useDeleteCertificate();
  const [uploadOpen, setUploadOpen] = useState(false);
  /*
   * The whole record, not just its id: the confirmation has to name what it is about to
   * destroy, and the row it came from may be gone from the table by the time the dialog
   * is answered.
   */
  const [pendingDelete, setPendingDelete] = useState<CertificateRow | null>(null);
  const goBack = useGoBack('/suppliers');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down(MOBILE_BREAKPOINT), { noSsr: true });

  if (isPending) return <Typography color="text.secondary">Loading…</Typography>;
  if (isError) return <Alert severity="error">{error.message}</Alert>;

  return (
    <Stack spacing={2.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Tooltip title="Back">
          <IconButton
            onClick={goBack}
            size="small"
            sx={{
              '&&': { p: 0, minWidth: 'auto', minHeight: 'auto' },
              borderRadius: '8px',
              '&::after': {
                content: '""',
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: 44,
                height: 44,
              },
            }}
          >
            <ArrowLeft size={18} />
          </IconButton>
        </Tooltip>

        {/* A tier-3 supplier's ancestry is four links deep, which wraps to three lines on
            a phone and pushes the heading off the first screen. Collapsed to
            "Suppliers … this one" there — the middle of a trail is the least useful part
            of it, and the ancestors are all reachable from the chain map anyway. */}
        <Breadcrumbs
          maxItems={isMobile ? 2 : 8}
          itemsBeforeCollapse={1}
          itemsAfterCollapse={1}
          sx={{ minWidth: 0 }}
        >
          <Link component={RouterLink} to="/suppliers" underline="hover" color="inherit">
            Suppliers
          </Link>
          {data.ancestors.map((ancestor) => (
            <Link
              key={ancestor.id}
              component={RouterLink}
              to={`/suppliers/${ancestor.id}`}
              underline="hover"
              color="inherit"
            >
              {ancestor.name}
            </Link>
          ))}
          <Typography color="text.primary">{data.name}</Typography>
        </Breadcrumbs>
      </Stack>

      <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
        <Typography variant="h1">{data.name}</Typography>
        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1 }}>
          <RiskChip level={data.riskLevel} score={data.riskScore} size="medium" />
          {!data.isCompliant && <NotCompliantChip size="medium" />}
          {!data.isActive && <Chip size="medium" color="warning" label="Inactive" />}
        </Stack>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gap: 2.5,
          // `minmax(0, …)` on every track. A bare `1fr` is `minmax(auto, 1fr)`, and that
          // `auto` floor is the width of the longest unbreakable string inside — so one
          // long email or file name silently widens the column past the viewport and
          // takes the whole page with it.
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 2fr) minmax(0, 1fr)' },
          alignItems: 'start',
        }}
      >
        <Stack spacing={2.5}>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="h2" gutterBottom>
              Profile
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gap: 2,
                gridTemplateColumns: {
                  xs: 'repeat(2, minmax(0, 1fr))',
                  sm: 'repeat(3, minmax(0, 1fr))',
                },
                mt: 2,
              }}
            >
              <Field label="Country" value={data.country?.name ?? data.countryCode} />
              <Field label="Tier" value={data.tier} />
              <Field label="Category" value={CATEGORY_LABELS[data.category]} />
              <Field label="Contact" value={data.contactEmail ?? '—'} wide />
              <Field label="ERP id" value={data.externalId ?? 'manual entry'} />
              <Field label="Source" value={data.sourceSystem === 'ERP' ? 'ERP sync' : 'Manual'} />
            </Box>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Stack
              direction="row"
              spacing={2}
              sx={{ justifyContent: 'space-between', alignItems: 'center' }}
            >
              <Typography variant="h2">Certificates</Typography>
              <Button
                variant="contained"
                size="small"
                startIcon={<Plus size={16} />}
                onClick={() => {
                  setUploadOpen(true);
                }}
              >
                Upload
              </Button>
            </Stack>

            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Required for {CATEGORY_LABELS[data.category].toLowerCase()}:{' '}
              {data.requirements.map((r) => CERTIFICATE_LABELS[r.type]).join(', ')}
            </Typography>

            {/* Requirements first: what is missing matters more than what is filed. */}
            <RequirementSummary requirements={data.requirements} />

            <Divider sx={{ my: 2 }} />

            {data.certificates.length === 0 ? (
              <Typography color="text.secondary" sx={{ py: 2 }}>
                No certificates on file.
              </Typography>
            ) : isMobile ? (
              <Stack spacing={1.5}>
                {data.certificates.map((certificate) => (
                  <RecordCard
                    key={certificate.id}
                    title={CERTIFICATE_LABELS[certificate.type]}
                    meta={
                      <>
                        <Typography variant="body2" color="text.secondary">
                          {certificate.issuer ?? 'No issuer recorded'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Expires {formatDate(certificate.expiryDate)} ·{' '}
                          {formatCountdown(certificate.daysUntilExpiry)}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ overflowWrap: 'anywhere' }}
                        >
                          {certificate.fileName} · {formatFileSize(certificate.fileSize)}
                          {certificate.certificateNumber !== null &&
                            ` · ${certificate.certificateNumber}`}
                        </Typography>
                      </>
                    }
                    chips={<CertificateStatusChip status={certificate.status} />}
                    action={
                      <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                        <IconButton
                          component="a"
                          href={fileUrl(certificate.id)}
                          aria-label={`Download ${certificate.fileName}`}
                        >
                          <Download size={18} />
                        </IconButton>
                        <IconButton
                          aria-label={`Delete ${CERTIFICATE_LABELS[certificate.type]} certificate`}
                          disabled={deleteCertificate.isPending}
                          onClick={() => {
                            setPendingDelete(certificate);
                          }}
                        >
                          <Trash2 size={18} />
                        </IconButton>
                      </Stack>
                    }
                  />
                ))}
              </Stack>
            ) : (
              /* `TableContainer` is what confines a too-wide table to its own scroll box.
                 Without it the table has no overflow context, so it stretches the Paper,
                 the grid and the page — every other element on the screen then appears
                 cropped even though nothing is wrong with any of them. */
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Type</TableCell>
                      <TableCell>Issuer</TableCell>
                      <TableCell>Expires</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell align="right">File</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.certificates.map((certificate) => (
                      <TableRow key={certificate.id}>
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
                        <TableCell>{certificate.issuer ?? '—'}</TableCell>
                        <TableCell>
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
                          <Stack direction="row" spacing={0.5} sx={{ justifyContent: 'flex-end' }}>
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
                            <IconButton
                              size="small"
                              aria-label={`Delete ${CERTIFICATE_LABELS[certificate.type]} certificate`}
                              disabled={deleteCertificate.isPending}
                              onClick={() => {
                                setPendingDelete(certificate);
                              }}
                            >
                              <Trash2 size={16} />
                            </IconButton>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </Stack>

        <Stack spacing={2.5}>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="h2" gutterBottom>
              Why this score
            </Typography>
            {data.risk ? (
              <Box sx={{ mt: 2 }}>
                <RiskBreakdown risk={data.risk} />
              </Box>
            ) : (
              <Typography color="text.secondary">Not scored.</Typography>
            )}
          </Paper>

          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="h2" gutterBottom>
              Upstream suppliers
            </Typography>
            {data.children.length === 0 ? (
              <Typography color="text.secondary" variant="body2" sx={{ mt: 1 }}>
                Nothing recorded upstream of this supplier.
              </Typography>
            ) : (
              <Stack spacing={1} sx={{ mt: 1 }}>
                {data.children.map((child) => (
                  <Link
                    key={child.id}
                    component={RouterLink}
                    to={`/suppliers/${child.id}`}
                    underline="hover"
                  >
                    {child.name}{' '}
                    <Typography component="span" variant="caption" color="text.secondary">
                      · tier {child.tier} · {child.countryCode}
                    </Typography>
                  </Link>
                ))}
              </Stack>
            )}
          </Paper>
        </Stack>
      </Box>

      <CertificateUploadDialog
        supplierId={id}
        open={uploadOpen}
        onClose={() => {
          setUploadOpen(false);
        }}
      />

      {/* Mounted only while a deletion is pending confirmation, so the description never
          has to survive the record being cleared — the alternative renders an empty
          dialog for the length of the closing fade. */}
      {pendingDelete !== null && (
        <ConfirmDialog
          open
          title="Delete this certificate?"
          description={
            <>
              <Box component="strong" sx={{ color: 'text.primary' }}>
                {CERTIFICATE_LABELS[pendingDelete.type]}
              </Box>
              {pendingDelete.issuer !== null && ` from ${pendingDelete.issuer}`}
              {pendingDelete.certificateNumber !== null && ` · ${pendingDelete.certificateNumber}`}
              {` · expires ${formatDate(pendingDelete.expiryDate)}.`}
              <Box sx={{ mt: 1.5 }}>
                The stored file is removed permanently and cannot be recovered. This supplier&apos;s
                compliance and risk score are recalculated without it, which may change the score of
                everything downstream of it.
              </Box>
            </>
          }
          confirmLabel="Delete"
          pendingLabel="Deleting…"
          pending={deleteCertificate.isPending}
          onCancel={() => {
            setPendingDelete(null);
          }}
          onConfirm={() => {
            deleteCertificate.mutate(pendingDelete.id, {
              onSuccess: () => {
                setPendingDelete(null);
              },
            });
          }}
        />
      )}
    </Stack>
  );
}
