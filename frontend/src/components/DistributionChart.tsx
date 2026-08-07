import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { InfoNote } from './InfoNote.tsx';

export interface DistributionDatum {
  key: string;
  label: string;
  count: number;
  color: string;
}

interface DistributionChartProps {
  title: string;
  data: readonly DistributionDatum[];
  total: number;
  /** Read aloud in place of the chart, so it has to carry every value. Never shown. */
  summary: string;
  /** Visible caption. Says how to read the distribution; never restates its numbers. */
  note: string;
}

/**
 * Horizontal bars, one measure, one axis.
 *
 * A pie was rejected: three slices compare badly, and part-to-whole is already carried
 * by the table view's share column. Every bar is labelled with its value — partly because three
 * labels are not clutter, and partly because the amber fill sits at 1.87:1 against a
 * light surface, which obliges visible labels rather than colour alone.
 *
 * The table view is the WCAG-clean twin: keyboard reachable, screen-reader legible, and
 * the place every value stays available when the tooltip is not.
 */
export function DistributionChart({ title, data, total, summary, note }: DistributionChartProps) {
  const [asTable, setAsTable] = useState(false);
  const max = Math.max(...data.map((datum) => datum.count), 1);

  return (
    <Stack spacing={1.5} sx={{ height: '100%' }}>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h2">{title}</Typography>
        <Button
          size="small"
          onClick={() => {
            setAsTable((current) => !current);
          }}
          aria-pressed={asTable}
        >
          {asTable ? 'Show chart' : 'Show table'}
        </Button>
      </Stack>

      {asTable ? (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{title}</TableCell>
              <TableCell align="right">Suppliers</TableCell>
              <TableCell align="right">Share</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.map((datum) => (
              <TableRow key={datum.key}>
                <TableCell>{datum.label}</TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {datum.count}
                </TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {total === 0 ? '—' : `${String(Math.round((datum.count / total) * 100))}%`}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Box
          role="img"
          aria-label={summary}
          sx={{
            width: '100%',
            height: 190,
            /* Recharts stamps `tabindex="-1"` on every z-index layer, so a tap focuses
               the group and the browser rings its bounding box. Only pointer focus is
               dropped — nothing here is tab-reachable, so no real indicator is lost. */
            '& :focus:not(:focus-visible)': { outline: 'none' },
          }}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={[...data]}
              layout="vertical"
              margin={{ top: 4, right: 34, bottom: 4, left: 4 }}
              barCategoryGap={10}
              /* On by default, and it marks the chart's own `<svg>` `role="application"`
                 with `tabindex="0"` — an interactive widget inside the `role="img"`
                 above, announcing itself as two contradictory things. */
              accessibilityLayer={false}
            >
              <XAxis type="number" domain={[0, max]} hide />
              <YAxis
                type="category"
                dataKey="label"
                axisLine={false}
                tickLine={false}
                width={112}
                tick={{ fontSize: 13, fill: 'currentColor' }}
              />
              <Tooltip
                cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                formatter={(value) => `${String(value)} suppliers`}
                contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13 }}
              />
              {/* 4px rounded data-end, square against the baseline. */}
              <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={26} isAnimationActive={false}>
                {data.map((datum) => (
                  <Cell key={datum.key} fill={datum.color} />
                ))}
                <LabelList
                  dataKey="count"
                  position="right"
                  offset={8}
                  style={{ fontSize: 13, fontWeight: 700, fill: 'currentColor' }}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Box>
      )}

      <InfoNote>{note}</InfoNote>
    </Stack>
  );
}
