import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildFixturePdf, groundTruth } from './buildFixtures.ts';
import { FIXTURES } from './fixtureSpecs.ts';

/**
 * Writes the synthetic eval set and its ground truth.
 *
 *   npm run eval:fixtures -w @clearchain/backend
 *
 * The output is committed; eval/fixtures.test.ts fails if it drifts from the specs.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'fixtures');

await mkdir(outDir, { recursive: true });

for (const fixture of FIXTURES) {
  await writeFile(path.join(outDir, `${fixture.id}.pdf`), await buildFixturePdf(fixture));
}

await writeFile(
  path.join(here, 'ground-truth.json'),
  `${JSON.stringify(groundTruth(), null, 2)}\n`,
);

console.log(`Wrote ${String(FIXTURES.length)} fixtures to ${outDir}`);
