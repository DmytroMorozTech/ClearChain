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
import { CERTIFICATE_LABELS } from '../format.ts';

const TYPES = Object.keys(CERTIFICATE_LABELS) as CertificateType[];

const today = (): string => new Date().toISOString().slice(0, 10);

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
  const [file, setFile] = useState<File | null>(null);

  const error = upload.error;
  const fieldErrors =
    error instanceof ApiError && error.details
      ? new Map(error.details.map((detail) => [detail.path, detail.message]))
      : new Map<string, string>();

  function reset() {
    setType('ISO_14001');
    setIssueDate(today());
    setExpiryDate('');
    setFile(null);
    upload.reset();
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
              <TextField
                label="Issue date"
                type="date"
                value={issueDate}
                onChange={(event) => {
                  setIssueDate(event.target.value);
                }}
                slotProps={{ inputLabel: { shrink: true } }}
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
                slotProps={{ inputLabel: { shrink: true } }}
                error={fieldErrors.has('expiryDate')}
                helperText={fieldErrors.get('expiryDate')}
                fullWidth
                required
              />
            </Stack>

            <Button component="label" variant="outlined" startIcon={<Upload size={17} />}>
              {file ? file.name : 'Choose file (PDF, PNG or JPEG)'}
              <input
                type="file"
                hidden
                accept="application/pdf,image/png,image/jpeg"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                }}
              />
            </Button>

            <Typography variant="caption" color="text.secondary">
              An expiry date in the past is accepted — it is filed as a historical record and shown
              as expired.
            </Typography>
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
