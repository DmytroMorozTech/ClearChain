import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { RefreshCw } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { useRunErpSync } from '../api/queries.ts';
import type { SyncLog, SyncOutcome } from '../api/schemas.ts';
import { formatTimestamp } from '../format.ts';
import { InfoNote } from './InfoNote.tsx';

const STATUS_COLOR = {
  SUCCESS: 'success',
  PARTIAL: 'warning',
  FAILED: 'error',
  RUNNING: 'info',
} as const;

/**
 * Each outcome, with the rule that produced it.
 *
 * The counts alone assume the reader already knows the domain — "unchanged" and "not in
 * feed" are the two that carry the most logic and read as the most interchangeable. The
 * explanations describe what the category *means* rather than what this run did, so they
 * stay true at any count and a zero is as informative as a thirty-two.
 */
const OUTCOMES = [
  {
    key: 'created',
    label: 'Created',
    of: (run: SyncOutcome) => run.recordsCreated,
    explanation:
      'Named in the export but absent from the database, so they were inserted. Parents are written before their children, which is why a record may name a parent that appears further down the file.',
  },
  {
    key: 'updated',
    label: 'Updated',
    of: (run: SyncOutcome) => run.recordsUpdated,
    explanation:
      'Already present, but at least one field differed from the export — name, country, category, contact or parent — so the stored record was rewritten to match.',
  },
  {
    key: 'unchanged',
    label: 'Unchanged',
    of: (run: SyncOutcome) => run.recordsUnchanged,
    explanation:
      'Matched the export field for field, so nothing was written. Run the same export twice and every record lands here: that is what makes the sync idempotent rather than merely harmless.',
  },
  {
    key: 'rejected',
    label: 'Rejected',
    of: (run: SyncOutcome) => run.recordsRejected,
    explanation:
      'Failed a check before anything was written — an unknown country, a missing parent, a loop, or a fourth tier — and were reported instead of applied. The rest of the batch still went through.',
  },
  {
    key: 'notInFeed',
    label: 'Not in feed',
    of: (run: SyncOutcome) => run.recordsNotInFeed,
    explanation:
      'Held by the application but never mentioned by this export. Nothing is ever deleted on the strength of an absence, so they were counted and left alone.',
  },
] as const;

// Five rows at 170ms apart plus the 360ms of the last one: the reveal settles a little
// over a second after the results land. Longer travel than the earlier, quicker version,
// because a slow fade over a short distance reads as a lag rather than as movement.
const ROW_STAGGER_MS = 170;
const ROW_DURATION_MS = 360;

function revealSx(index: number) {
  return {
    '@keyframes syncRowIn': {
      from: { opacity: 0, transform: 'translateY(10px)' },
      to: { opacity: 1, transform: 'none' },
    },
    animation: `syncRowIn ${String(ROW_DURATION_MS)}ms ease-out backwards`,
    animationDelay: `${String(index * ROW_STAGGER_MS)}ms`,
    // Honoured rather than merely tolerated: the reveal carries no information, so
    // removing it costs the reader nothing.
    '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
  } as const;
}

export function SyncPanel({ lastSync }: { lastSync: SyncLog | null }) {
  const sync = useRunErpSync();
  const result = sync.data;

  const resultsRef = useRef<HTMLDivElement>(null);
  const logId = result?.logId;

  useEffect(() => {
    if (logId === undefined) return;
    const node = resultsRef.current;
    if (node === null) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    node.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
  }, [logId]);

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

      {result === undefined && (
        <Box sx={{ mt: 1.5 }}>
          <InfoNote>
            Runs against a sample export standing in for a supplier feed from a real ERP system.
            Reports how many records were created, updated, left unchanged and rejected — and is
            safe to run as often as you like.
          </InfoNote>
        </Box>
      )}

      {sync.isError && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {sync.error.message}
        </Alert>
      )}

      {result && (
        <Box key={result.logId} ref={resultsRef} sx={{ mt: 2 }}>
          <Typography variant="body2" color="text.secondary">
            {result.recordsRead} records read from the sample export.
          </Typography>

          <Stack spacing={1.75} sx={{ mt: 2 }}>
            {OUTCOMES.map((outcome, index) => {
              const value = outcome.of(result);
              return (
                <Stack
                  key={outcome.key}
                  direction="row"
                  spacing={2}
                  sx={{ alignItems: 'baseline', ...revealSx(index) }}
                >
                  <Typography
                    sx={{
                      fontSize: 22,
                      fontWeight: 700,
                      fontVariantNumeric: 'tabular-nums',
                      lineHeight: 1.2,
                      minWidth: 36,
                      textAlign: 'right',
                      flexShrink: 0,
                      // Only the rejections earn colour, and only when there are any:
                      // a row of zeroes should not look like a row of warnings.
                      color:
                        outcome.key === 'rejected' && value > 0 ? 'warning.main' : 'text.primary',
                    }}
                  >
                    {value}
                  </Typography>

                  <Box>
                    <Typography sx={{ fontWeight: 600, lineHeight: 1.3 }}>
                      {outcome.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {outcome.explanation}
                    </Typography>

                    {outcome.key === 'rejected' && result.rejections.length > 0 && (
                      <Box component="ul" sx={{ m: 0, mt: 0.75, pl: 2.5 }}>
                        {result.rejections.map((rejection) => (
                          <Typography
                            component="li"
                            variant="caption"
                            color="text.secondary"
                            key={`${rejection.externalId ?? '?'}-${rejection.reason}`}
                          >
                            <Box component="strong" sx={{ color: 'text.primary' }}>
                              {rejection.externalId ?? 'unnamed record'}
                            </Box>{' '}
                            — {rejection.detail}
                          </Typography>
                        ))}
                      </Box>
                    )}
                  </Box>
                </Stack>
              );
            })}
          </Stack>

          <Box sx={{ mt: 2.5 }}>
            <InfoNote>
              Two records in the sample export are invalid on purpose — an unknown country and a
              missing parent — so that a single run exercises the rejection path alongside the
              records that succeed. A PARTIAL result here is the fixture working, not a fault.
            </InfoNote>
          </Box>
        </Box>
      )}

      {lastSync ? (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
          Last run {formatTimestamp(lastSync.startedAt)} · source {lastSync.source}
          {lastSync.sourceFileHash && ` · file ${lastSync.sourceFileHash.slice(0, 12)}`}
        </Typography>
      ) : (
        <Typography color="text.secondary" sx={{ mt: 2 }}>
          No sync has run yet.
        </Typography>
      )}
    </Paper>
  );
}
