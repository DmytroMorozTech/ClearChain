import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { FileText, Upload } from 'lucide-react';
import { type FormEvent, type ReactElement, useEffect, useRef, useState } from 'react';

import { ApiError } from '../api/client.ts';
import {
  useExtractCertificate,
  useExtractionStatus,
  useUploadCertificate,
} from '../api/queries.ts';
import type { CertificateType, ExtractableField, ExtractionResponse } from '../api/schemas.ts';
import {
  type FormFields,
  extractionErrorMessage,
  fieldFlags,
  mergeSuggestion,
  planForChosenFile,
} from '../extraction.ts';
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

/**
 * When the "usually takes a few seconds" promise stops being true. The eval puts a
 * normal read at 3–5 s; past this the user deserves to hear it can take longer.
 */
const SLOW_READ_MS = 10_000;

const today = (): string => new Date().toISOString().slice(0, 10);

const EMPTY_FORM = (): FormFields => ({
  type: 'ISO_14001',
  issuer: '',
  certificateNumber: '',
  issueDate: today(),
  expiryDate: '',
});

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

/**
 * choose → reading → review. The fields only appear once there is something to review:
 * either what the file says, or — when reading is off, used up or fails — an empty form
 * with the reason. Manual entry is always one step away, never a dead end.
 */
type Step = 'choose' | 'reading' | 'review';

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

  const [step, setStep] = useState<Step>('choose');
  /** True once the user opted out of reading, so a new file goes straight to the form. */
  const [manual, setManual] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const readAbort = useRef<AbortController | null>(null);

  const [type, setType] = useState<CertificateType>('ISO_14001');
  const [issueDate, setIssueDate] = useState(today());
  const [expiryDate, setExpiryDate] = useState('');
  const [issuer, setIssuer] = useState('');
  const [certificateNumber, setCertificateNumber] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const status = useExtractionStatus(open);
  const extraction = useExtractCertificate();
  const [extracted, setExtracted] = useState<ExtractionResponse | null>(null);
  const flags = extracted === null ? {} : fieldFlags(extracted);
  const generalWarnings = extracted?.warnings.filter((warning) => warning.field === null) ?? [];
  const needsCheck = generalWarnings.length > 0 || Object.keys(flags).length > 0;
  const aiOn = status.data?.enabled !== false;

  const error = upload.error;
  const fieldErrors =
    error instanceof ApiError && error.details
      ? new Map(error.details.map((detail) => [detail.path, detail.message]))
      : new Map<string, string>();

  /** The quote behind a suggested value, for the hover tooltip — verified or not. */
  const quoteFor = (field: ExtractableField): string | null =>
    extracted?.suggestion[field] != null ? (extracted.evidence[field] ?? null) : null;

  /** Highlights a field the extraction could not vouch for; server errors still win. */
  const flagProps = (field: ExtractableField) => {
    const flag = flags[field];
    return {
      ...(flag && !fieldErrors.has(field) ? { color: 'warning' as const, focused: true } : {}),
      helperText: fieldErrors.get(field) ?? flag?.message,
    };
  };

  useEffect(() => {
    if (step !== 'reading') return undefined;
    setSlow(false);
    const timer = setTimeout(() => {
      setSlow(true);
    }, SLOW_READ_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [step]);

  function resetForm() {
    const empty = EMPTY_FORM();
    setType(empty.type);
    setIssueDate(empty.issueDate);
    setExpiryDate(empty.expiryDate);
    setIssuer(empty.issuer);
    setCertificateNumber(empty.certificateNumber);
    setExtracted(null);
    setNotice(null);
    upload.reset();
    extraction.reset();
  }

  function reset() {
    readAbort.current?.abort();
    resetForm();
    setStep('choose');
    setManual(false);
    setFile(null);
    setFileError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function startReading(picked: File) {
    const controller = new AbortController();
    readAbort.current = controller;
    setStep('reading');
    extraction.mutate(
      { supplierId, file: picked, signal: controller.signal },
      {
        onSuccess: (response) => {
          // Reading always starts from an empty form — the fields are not shown before
          // it — so the suggestion is laid over the defaults, never over whatever the
          // previous file left in state (this callback would see a stale copy of it).
          const merged = mergeSuggestion(EMPTY_FORM(), response.suggestion, {
            untouched: ['issueDate'],
          });
          setType(merged.type);
          setIssuer(merged.issuer);
          setCertificateNumber(merged.certificateNumber);
          setIssueDate(merged.issueDate);
          setExpiryDate(merged.expiryDate);
          setExtracted(response);
          setStep('review');
        },
        onError: (failure) => {
          // A cancelled read is the user's own choice, not something to report.
          if (controller.signal.aborted) return;
          setNotice(extractionErrorMessage(failure));
          setStep('review');
        },
      },
    );
  }

  function chooseFile(picked: File | null) {
    if (picked === null) return;
    if (picked.size > MAX_UPLOAD_BYTES) {
      setFileError(
        `That file is ${formatFileSize(picked.size)}. The limit is ${formatFileSize(MAX_UPLOAD_BYTES)}.`,
      );
      return;
    }
    setFile(picked);
    setFileError(null);

    if (manual) {
      setStep('review');
      return;
    }

    // A new file means new suggestions: nothing from the previous one may linger.
    resetForm();
    const plan = planForChosenFile(status.data);
    if (plan === 'extract') {
      startReading(picked);
      return;
    }
    if (plan === 'manual-quota') {
      setNotice(
        "You've reached today's limit for AI extraction. Please fill in the details manually.",
      );
    }
    setStep('review');
  }

  function cancelReading() {
    readAbort.current?.abort();
    extraction.reset();
    setFile(null);
    setStep('choose');
  }

  function enterManually() {
    setManual(true);
    setStep('review');
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

  const filePicker = (label: string) => (
    <Stack spacing={0.75}>
      <Button
        component="label"
        variant="outlined"
        color={fileError === null ? 'primary' : 'error'}
        startIcon={<Upload size={17} />}
      >
        {label}
        <input
          type="file"
          hidden
          accept="application/pdf,image/png,image/jpeg"
          onChange={(event) => {
            chooseFile(event.target.files?.[0] ?? null);
            // Lets the same file be picked again after Cancel.
            event.target.value = '';
          }}
        />
      </Button>
      {fileError !== null && (
        <Typography variant="caption" color="error">
          {fileError}
        </Typography>
      )}
    </Stack>
  );

  return (
    <Dialog
      open={open}
      // While a read is in flight only Cancel closes this step: a stray click outside or
      // Esc would throw away a result that is already being paid for.
      onClose={step === 'reading' ? undefined : handleClose}
      maxWidth="sm"
      fullWidth
      fullScreen={fullScreen}
    >
      <form onSubmit={handleSubmit}>
        <DialogTitle>Upload certificate</DialogTitle>

        <DialogContent>
          {step === 'choose' && (
            <Stack spacing={2.5} sx={{ pt: 1 }}>
              {filePicker('Choose file (PDF, PNG or JPEG)')}
              {aiOn ? (
                <Typography variant="body2" color="text.secondary">
                  When you choose a file, ClearChain sends it to an external AI service
                  (Anthropic&apos;s Claude API) to read the certificate details. You&apos;ll then
                  review the extracted values and correct them if needed. Nothing is saved until you
                  confirm.
                  {status.data !== undefined &&
                    ` ${String(status.data.remainingToday)} extractions left today.`}
                </Typography>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Choose the certificate file, then enter its details.
                </Typography>
              )}
              {aiOn && (
                <Link
                  component="button"
                  type="button"
                  onClick={enterManually}
                  sx={{ alignSelf: 'flex-start' }}
                >
                  Enter the details manually instead
                </Link>
              )}
            </Stack>
          )}

          {step === 'reading' && (
            <Stack spacing={2} sx={{ pt: 1, pb: 2, alignItems: 'center', textAlign: 'center' }}>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignSelf: 'stretch', alignItems: 'center' }}
              >
                <FileText size={17} />
                <Typography variant="body2">{file?.name}</Typography>
              </Stack>
              <CircularProgress size={36} sx={{ mt: 2 }} />
              <Typography variant="subtitle1">Reading the certificate…</Typography>
              <Typography variant="body2" color="text.secondary">
                {slow
                  ? 'Still working — this can take up to 45 seconds.'
                  : 'This usually takes a few seconds.'}
              </Typography>
            </Stack>
          )}

          {step === 'review' && (
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

              {filePicker(file ? file.name : 'Choose file (PDF, PNG or JPEG)')}

              {notice !== null && <Alert severity="warning">{notice}</Alert>}

              {/* Green only when nothing needs a second look. Field-level problems are
                  explained under their fields; only document-wide ones are listed here. */}
              {extracted && (
                <Alert severity={needsCheck ? 'warning' : 'success'}>
                  {needsCheck
                    ? 'The details below were read from the document. Please check the highlighted fields before saving.'
                    : 'The details below were read from the document. Please check them before saving.'}
                  {generalWarnings.length > 0 && (
                    <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                      {generalWarnings.map((warning, index) => (
                        <li key={index}>{warning.message}</li>
                      ))}
                    </ul>
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
                An expiry date in the past is accepted — it is filed as a historical record and
                shown as expired.
              </InfoNote>
            </Stack>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2 }}>
          {step === 'reading' ? (
            <Button onClick={cancelReading}>Cancel</Button>
          ) : (
            <Button onClick={handleClose}>Cancel</Button>
          )}
          {step === 'review' && (
            <Button
              type="submit"
              variant="contained"
              disabled={file === null || expiryDate === '' || upload.isPending}
            >
              {upload.isPending ? 'Saving…' : 'Save certificate'}
            </Button>
          )}
        </DialogActions>
      </form>
    </Dialog>
  );
}
