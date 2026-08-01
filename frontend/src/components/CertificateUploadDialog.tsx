import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { Upload } from 'lucide-react';
import { type FormEvent, useState } from 'react';

import { ApiError } from '../api/client.ts';
import { useUploadCertificate } from '../api/queries.ts';
import type { CertificateType } from '../api/schemas.ts';
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
  const [expiryDate, setExpiryDate] = useState('');
  const [issuer, setIssuer] = useState('');
  const [certificateNumber, setCertificateNumber] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const error = upload.error;
  const fieldErrors =
    error instanceof ApiError && error.details
      ? new Map(error.details.map((detail) => [detail.path, detail.message]))
      : new Map<string, string>();

  function reset() {
    setType('ISO_14001');
    setIssueDate(today());
    setExpiryDate('');
    setIssuer('');
    setCertificateNumber('');
    setFile(null);
    setFileError(null);
    upload.reset();
  }

  function chooseFile(picked: File | null) {
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

            <TextField
              select
              label="Certificate type"
              value={type}
              onChange={(event) => {
                setType(event.target.value as CertificateType);
              }}
              fullWidth
            >
              {TYPES.map((value) => (
                <MenuItem key={value} value={value}>
                  {CERTIFICATE_LABELS[value]}
                </MenuItem>
              ))}
            </TextField>

            {/* Side by side these are ~160px each on a phone, which is narrower than the
                native date picker wants. */}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              {/* The bounds restate rules the API already enforces, so a mistake is
                  caught by the picker instead of by a round trip. The server remains the
                  authority — a typed-in date that slips past the browser still gets the
                  same answer it always did. */}
              <TextField
                label="Issue date"
                type="date"
                value={issueDate}
                onChange={(event) => {
                  setIssueDate(event.target.value);
                }}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today() } }}
                error={fieldErrors.has('issueDate')}
                helperText={fieldErrors.get('issueDate')}
                fullWidth
                required
              />
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
                helperText={fieldErrors.get('expiryDate')}
                fullWidth
                required
              />
            </Stack>

            {/* Free text, not a list: the issuing bodies in the seed data are only the
                ones this dataset happens to use, and a certificate can be issued by an
                auditor nobody has enumerated. Both are optional — the API accepts a
                certificate without either. */}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Issuer"
                placeholder="e.g. TÜV SÜD"
                value={issuer}
                onChange={(event) => {
                  setIssuer(event.target.value);
                }}
                error={fieldErrors.has('issuer')}
                helperText={fieldErrors.get('issuer')}
                fullWidth
              />
              <TextField
                label="Certificate number"
                placeholder="e.g. ISO-54532"
                value={certificateNumber}
                onChange={(event) => {
                  setCertificateNumber(event.target.value);
                }}
                error={fieldErrors.has('certificateNumber')}
                helperText={fieldErrors.get('certificateNumber')}
                fullWidth
              />
            </Stack>

            <Stack spacing={0.75}>
              <Button
                component="label"
                variant="outlined"
                color={fileError === null ? 'primary' : 'error'}
                startIcon={<Upload size={17} />}
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
