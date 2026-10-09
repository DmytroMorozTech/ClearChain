import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { Sparkles, Upload } from 'lucide-react';
import { type FormEvent, type ReactElement, useState } from 'react';

import { ApiError } from '../api/client.ts';
import {
  useExtractCertificate,
  useExtractionStatus,
  useUploadCertificate,
} from '../api/queries.ts';
import type { CertificateType, ExtractableField, ExtractionResponse } from '../api/schemas.ts';
import { extractionErrorMessage, fieldFlags, mergeSuggestion } from '../extraction.ts';
import { CERTIFICATE_LABELS, formatFileSize } from '../format.ts';
import { InfoNote } from './InfoNote.tsx';

const TYPES = Object.keys(CERTIFICATE_LABELS) as CertificateType[];

/**
 * Mirrors the backend's `MAX_UPLOAD_BYTES` default.
 *
 * Duplicated rather than fetched: the server stays the authority and rejects an
 * oversized file whatever the browser believes, so the only thing this buys is refusing
 * a 40MB pick before it spends a minute on the wire. Serving the real limit would mean
 * putting configuration on the open health probe, which is the wrong home for it.
 */
const MAX_UPLOAD_BYTES = 5_242_880;

/** Guards against a typo'd year rather than any rule the API enforces. */
const MAX_EXPIRY_YEARS_AHEAD = 50;

const today = (): string => new Date().toISOString().slice(0, 10);

function shiftedFromToday(years: number): string {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString().slice(0, 10);
}

/**
 * The API requires expiry strictly *after* issue, but the picker's `min` is inclusive —
 * so it has to start a day later, or the one date the browser waves through is the one
 * the server sends back as an error.
 */
function dayAfter(isoDate: string): string | undefined {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return undefined;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Shows, on hover, the document text a suggested value was taken from — so checking a
 * value means comparing it with its source rather than reopening the PDF.
 */
function SourceQuote({ quote, children }: { quote: string | null; children: ReactElement }) {
  if (quote === null) return children;
  return (
    <Tooltip title={`Found in document: “${quote}”`} placement="top-start">
      {children}
    </Tooltip>
  );
}

interface CertificateUploadDialogProps {
  supplierId: string;
  open: boolean;
  onClose: () => void;
}

export function CertificateUploadDialog({
  supplierId,
  open,
  onClose,
}: CertificateUploadDialogProps) {
  const upload = useUploadCertificate();
  const theme = useTheme();
  /**
   * `sm`, not the app-wide `md`. This is the one deliberate exception: a 600px dialog
   * still sits comfortably on a 768px tablet, so going full-screen there would be a
   * worse experience, not a better one. The threshold that matters here is where the
   * form stops fitting — a date picker needs about 160px and there are two of them.
   */
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });

  const [type, setType] = useState<CertificateType>('ISO_14001');
  const [issueDate, setIssueDate] = useState(today());
  // Whether the issue date is still the "today" default rather than something chosen.
  const [issueDateTouched, setIssueDateTouched] = useState(false);
  const [expiryDate, setExpiryDate] = useState('');
  const [issuer, setIssuer] = useState('');
  const [certificateNumber, setCertificateNumber] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const status = useExtractionStatus(open);
  const extraction = useExtractCertificate();
  const [extracted, setExtracted] = useState<ExtractionResponse | null>(null);
  const flags = extracted === null ? {} : fieldFlags(extracted);
  const extractionReady = status.data?.enabled === true && status.data.remainingToday > 0;

  /** The quote behind a suggested value, for the hover tooltip — verified or not. */
  const quoteFor = (field: ExtractableField): string | null =>
    extracted?.suggestion[field] != null ? (extracted.evidence[field] ?? null) : null;

  /** Highlights a field the extraction could not vouch for; server errors still win. */
  const flagProps = (field: ExtractableField) => {
    const flag = flags[field];
    return {
      ...(flag && !fieldErrors.has(field) ? { color: 'warning' as const, focused: true } : {}),
      helperText: fieldErrors.get(field) ?? flag?.message,
      disabled: extraction.isPending,
    };
  };

  const error = upload.error;
  const fieldErrors =
    error instanceof ApiError && error.details
      ? new Map(error.details.map((detail) => [detail.path, detail.message]))
      : new Map<string, string>();

  function reset() {
    setType('ISO_14001');
    setIssueDate(today());
    setIssueDateTouched(false);
    setExpiryDate('');
    setIssuer('');
    setCertificateNumber('');
    setFile(null);
    setFileError(null);
    upload.reset();
    extraction.reset();
    setExtracted(null);
  }

  function chooseFile(picked: File | null) {
    // Suggestions describe the previous file; they must not linger next to a new one.
    extraction.reset();
    setExtracted(null);
    if (picked !== null && picked.size > MAX_UPLOAD_BYTES) {
      setFile(null);
      setFileError(
        `That file is ${formatFileSize(picked.size)}. The limit is ${formatFileSize(MAX_UPLOAD_BYTES)}.`,
      );
      return;
    }
    setFile(picked);
    setFileError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleExtract() {
    if (file === null) return;
    extraction.mutate(
      { supplierId, file },
      {
        onSuccess: (response) => {
          const merged = mergeSuggestion(
            { type, issuer, certificateNumber, issueDate, expiryDate },
            response.suggestion,
            { untouched: issueDateTouched ? [] : ['issueDate'] },
          );
          setType(merged.type);
          setIssuer(merged.issuer);
          setCertificateNumber(merged.certificateNumber);
          setIssueDate(merged.issueDate);
          setExpiryDate(merged.expiryDate);
          setExtracted(response);
        },
      },
    );
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (file === null) return;

    const form = new FormData();
    form.set('type', type);
    form.set('issueDate', issueDate);
    form.set('expiryDate', expiryDate);
    form.set('file', file);

    const trimmedIssuer = issuer.trim();
    const trimmedNumber = certificateNumber.trim();
    if (trimmedIssuer !== '') form.set('issuer', trimmedIssuer);
    if (trimmedNumber !== '') form.set('certificateNumber', trimmedNumber);

    upload.mutate({ supplierId, form }, { onSuccess: handleClose });
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth fullScreen={fullScreen}>
      <form onSubmit={handleSubmit}>
        <DialogTitle>Upload certificate</DialogTitle>

        <DialogContent>
          <Stack spacing={2.5} sx={{ pt: 1 }}>
            {/*
              The server is the authority on what is acceptable, so its message is shown
              verbatim rather than replaced by a guess: it knows about magic-byte
              mismatches and date ordering that the browser does not.
            */}
            {error && (
              <Alert severity="error">
                {error instanceof ApiError ? error.message : 'Upload failed'}
              </Alert>
            )}

            {/* The file comes first now: with AI extraction it can fill in everything
                below it, so choosing it is the natural first step. */}
            <Stack spacing={0.75}>
              <Button
                component="label"
                variant="outlined"
                color={fileError === null ? 'primary' : 'error'}
                startIcon={<Upload size={17} />}
                disabled={extraction.isPending}
              >
                {file ? file.name : 'Choose file (PDF, PNG or JPEG)'}
                <input
                  type="file"
                  hidden
                  accept="application/pdf,image/png,image/jpeg"
                  onChange={(event) => {
                    chooseFile(event.target.files?.[0] ?? null);
                  }}
                />
              </Button>
              {fileError !== null && (
                <Typography variant="caption" color="error">
                  {fileError}
                </Typography>
              )}
            </Stack>

            {file !== null && (
              <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
                <Tooltip
                  title={
                    status.data?.enabled === false
                      ? 'AI extraction is not enabled on this deployment'
                      : ''
                  }
                >
                  {/* A span, because a disabled button fires no hover events of its own. */}
                  <span>
                    <Button
                      variant="text"
                      onClick={handleExtract}
                      disabled={!extractionReady || extraction.isPending}
                      startIcon={
                        extraction.isPending ? (
                          <CircularProgress size={16} />
                        ) : (
                          <Sparkles size={17} />
                        )
                      }
                    >
                      {extraction.isPending ? 'Reading the document…' : 'Fill from file'}
                    </Button>
                  </span>
                </Tooltip>
                {/* Only when the feature is on: a disabled deployment sends nothing anywhere,
                    and saying otherwise would be a false privacy notice. */}
                {status.data?.enabled === true && (
                  <Typography variant="caption" color="text.secondary">
                    The file is sent to an external AI service (Anthropic) to read the fields. Check
                    every value before saving. {String(status.data.remainingToday)} left today.
                  </Typography>
                )}
              </Stack>
            )}

            {extraction.error && (
              <Alert severity="warning">{extractionErrorMessage(extraction.error)}</Alert>
            )}

            {extracted && (
              <Alert severity={extracted.warnings.length > 0 ? 'warning' : 'success'}>
                {extracted.warnings.length > 0 ? (
                  <>
                    Fields were filled in from the document. Please check the highlighted ones:
                    <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                      {extracted.warnings.map((warning, index) => (
                        <li key={index}>{warning.message}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  'Fields were filled in from the document. Please check them before saving.'
                )}
              </Alert>
            )}

            <SourceQuote quote={quoteFor('type')}>
              <TextField
                select
                label="Certificate type"
                value={type}
                onChange={(event) => {
                  setType(event.target.value as CertificateType);
                }}
                {...flagProps('type')}
                fullWidth
              >
                {TYPES.map((value) => (
                  <MenuItem key={value} value={value}>
                    {CERTIFICATE_LABELS[value]}
                  </MenuItem>
                ))}
              </TextField>
            </SourceQuote>

            {/* Side by side these are ~160px each on a phone, which is narrower than the
                native date picker wants. */}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              {/* The bounds restate rules the API already enforces, so a mistake is
                  caught by the picker instead of by a round trip. The server remains the
                  authority — a typed-in date that slips past the browser still gets the
                  same answer it always did. */}
              <SourceQuote quote={quoteFor('issueDate')}>
                <TextField
                  label="Issue date"
                  type="date"
                  value={issueDate}
                  onChange={(event) => {
                    setIssueDate(event.target.value);
                    setIssueDateTouched(true);
                  }}
                  slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today() } }}
                  error={fieldErrors.has('issueDate')}
                  {...flagProps('issueDate')}
                  fullWidth
                  required
                />
              </SourceQuote>
              <SourceQuote quote={quoteFor('expiryDate')}>
                <TextField
                  label="Expiry date"
                  type="date"
                  value={expiryDate}
                  onChange={(event) => {
                    setExpiryDate(event.target.value);
                  }}
                  slotProps={{
                    inputLabel: { shrink: true },
                    htmlInput: {
                      min: dayAfter(issueDate),
                      max: shiftedFromToday(MAX_EXPIRY_YEARS_AHEAD),
                    },
                  }}
                  error={fieldErrors.has('expiryDate')}
                  {...flagProps('expiryDate')}
                  fullWidth
                  required
                />
              </SourceQuote>
            </Stack>

            {/* Free text, not a list: the issuing bodies in the seed data are only the
                ones this dataset happens to use, and a certificate can be issued by an
                auditor nobody has enumerated. Both are optional — the API accepts a
                certificate without either. */}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <SourceQuote quote={quoteFor('issuer')}>
                <TextField
                  label="Issuer"
                  placeholder="e.g. TÜV SÜD"
                  value={issuer}
                  onChange={(event) => {
                    setIssuer(event.target.value);
                  }}
                  error={fieldErrors.has('issuer')}
                  {...flagProps('issuer')}
                  fullWidth
                />
              </SourceQuote>
              <SourceQuote quote={quoteFor('certificateNumber')}>
                <TextField
                  label="Certificate number"
                  placeholder="e.g. ISO-54532"
                  value={certificateNumber}
                  onChange={(event) => {
                    setCertificateNumber(event.target.value);
                  }}
                  error={fieldErrors.has('certificateNumber')}
                  {...flagProps('certificateNumber')}
                  fullWidth
                />
              </SourceQuote>
            </Stack>

            <InfoNote>
              An expiry date in the past is accepted — it is filed as a historical record and shown
              as expired.
            </InfoNote>
          </Stack>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={handleClose}>Cancel</Button>
          <Button
            type="submit"
            variant="contained"
            disabled={file === null || expiryDate === '' || upload.isPending}
          >
            {upload.isPending ? 'Uploading…' : 'Upload'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
