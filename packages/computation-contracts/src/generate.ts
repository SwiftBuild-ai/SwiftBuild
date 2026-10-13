import { z } from 'zod';
import { writeFile, readFile } from 'node:fs/promises';
import {
  ExecutionRequestSchema,
  ComputationReportSchema,
  AnalysisBundleSchema,
} from './index';
const schemas = {
  ExecutionRequest: ExecutionRequestSchema,
  ComputationReport: ComputationReportSchema,
  AnalysisBundle: AnalysisBundleSchema,
};
const output =
  JSON.stringify(
    Object.fromEntries(
      Object.entries(schemas).map(([name, schema]) => [
        name,
        z.toJSONSchema(schema),
      ]),
    ),
    null,
    2,
  ) + '\n';
const path = new URL(
  '../../../services/computation/contracts.json',
  import.meta.url,
);
if (process.argv.includes('--check')) {
  if ((await readFile(path, 'utf8')) !== output)
    throw new Error('Computation schema drift: run pnpm computation:generate.');
} else await writeFile(path, output);
