import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { type ReactNode, useId } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** Should name the thing being acted on and say what the action costs. */
  description: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pendingLabel,
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!pending) onCancel();
      }}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle id={titleId}>{title}</DialogTitle>

      <DialogContent>
        <DialogContentText id={descriptionId} component="div">
          {description}
        </DialogContentText>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onCancel} disabled={pending} autoFocus>
          Cancel
        </Button>
        <Button onClick={onConfirm} color="error" variant="contained" disabled={pending}>
          {pending ? pendingLabel : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
