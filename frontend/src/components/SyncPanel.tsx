import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { RefreshCw } from 'lucide-react';

import { useRunErpSync } from '../api/queries.ts';
import type { SyncLog } from '../api/schemas.ts';
import { formatTimestamp } from '../format.ts';

const STATUS_COLOR = {
  SUCCESS: 'success',
  PARTIAL: 'warning',
  FAILED: 'error',
  RUNNING: 'info',
} as const;

function Count({ label, value }: { label: string; value: number }) {
  return (
    <Box>
      <Typography
        sx={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}
      >
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );
}

export function SyncPanel({ lastSync }: { lastSync: SyncLog | null }) {
  const sync = useRunErpSync();
  const result = sync.data;

  return (
    <Paper variant="outlined" sx={{ p: 2.5 }}>
      <Stack
        direction="row"
        sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}
      >
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Typography variant="h2">ERP sync</Typography>
          {lastSync && (
            <Chip size="small" color={STATUS_COLOR[lastSync.status]} label={lastSync.status} />
          )}
        </Stack>

        <Button
          variant="contained"
          size="small"
          startIcon={<RefreshCw size={16} />}
          disabled={sync.isPending}
          onClick={() => {
            sync.mutate();
          }}
        >
          {sync.isPending ? 'Syncing…' : 'Run sync'}
        </Button>
      </Stack>

      {sync.isError && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {sync.error.message}
        </Alert>
      )}

      {/*
        The per-run breakdown is the point, not a success toast. Running the same export
        again reports zero created and zero updated, which is what makes the sync
        visibly idempotent rather than merely harmless.
      */}
      {result && (
        <Alert severity={result.recordsRejected > 0 ? 'warning' : 'success'} sx={{ mt: 2 }}>
          {result.recordsCreated} created · {result.recordsUpdated} updated ·{' '}
          {result.recordsUnchanged} unchanged · {result.recordsRejected} rejected
          {result.rejections.length > 0 && (
            <Box component="ul" sx={{ m: 0, mt: 1, pl: 2.5 }}>
              {result.rejections.map((rejection) => (
                <li key={`${rejection.externalId ?? '?'}-${rejection.reason}`}>
                  <strong>{rejection.externalId ?? 'unnamed record'}</strong> — {rejection.detail}
                </li>
              ))}
            </Box>
          )}
        </Alert>
      )}

      {lastSync ? (
        <>
          <Box
            sx={{
              display: 'grid',
              gap: 2,
              gridTemplateColumns: { xs: 'repeat(3, 1fr)', sm: 'repeat(6, 1fr)' },
              mt: 2.5,
            }}
          >
            <Count label="read" value={lastSync.recordsRead} />
            <Count label="created" value={lastSync.recordsCreated} />
            <Count label="updated" value={lastSync.recordsUpdated} />
            <Count label="unchanged" value={lastSync.recordsUnchanged} />
            <Count label="rejected" value={lastSync.recordsRejected} />
            <Count label="not in feed" value={lastSync.recordsNotInFeed} />
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
            Last run {formatTimestamp(lastSync.startedAt)} · source {lastSync.source}
            {lastSync.sourceFileHash && ` · file ${lastSync.sourceFileHash.slice(0, 12)}`}
          </Typography>
        </>
      ) : (
        <Typography color="text.secondary" sx={{ mt: 2 }}>
          No sync has run yet.
        </Typography>
      )}
    </Paper>
  );
}
