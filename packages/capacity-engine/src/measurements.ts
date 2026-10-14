import {
  PerformanceProfileSchema,
  type PerformanceProfile,
} from '@swiftbuild/architecture-schema';

function rowsOf(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    state: 'start' | 'unquoted' | 'quoted' | 'closed' = 'start',
    line = 1,
    fieldLine = 1;
  const malformed = (message: string) =>
    new Error(`CSV row ${fieldLine}, field ${row.length + 1}: ${message}`);
  const text = raw.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      if (state === 'quoted' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (state === 'quoted') state = 'closed';
      else if (state === 'start') state = 'quoted';
      else throw malformed('Unexpected quote in CSV field.');
    } else if (c === ',' && state !== 'quoted') {
      row.push(field);
      field = '';
      state = 'start';
      fieldLine = line;
    } else if ((c === '\n' || c === '\r') && state !== 'quoted') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((v) => v.trim())) rows.push(row);
      row = [];
      field = '';
      state = 'start';
      fieldLine = ++line;
    } else if (state === 'closed') {
      if (c !== ' ' && c !== '\t')
        throw malformed('Unexpected character after closing quote.');
    } else {
      field += c;
      if (state === 'start') state = 'unquoted';
      if (c === '\n' || (c === '\r' && text[i + 1] !== '\n')) line++;
    }
  }
  if (state === 'quoted') throw malformed('CSV contains an unclosed quote.');
  row.push(field);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
/** Import local samples for an already identified profile and evidence context. */
export function importMeasurementsCSV(
  raw: string,
  profile: PerformanceProfile,
): PerformanceProfile {
  if (new TextEncoder().encode(raw).length > 5 * 1024 * 1024)
    throw new Error('Measurement CSV exceeds 5 MB.');
  const rows = rowsOf(raw),
    headers = rows.shift()?.map((h) => h.trim());
  if (!headers || !rows.length)
    throw new Error('CSV requires a header and data rows.');
  const samples = headers.length === 1 && headers[0] === 'service_ms';
  const curve =
    headers[0] === 'requests_per_second' && headers[1] === 'mean_latency_ms';
  if (!samples && !curve)
    throw new Error(
      'Use service_ms, or requests_per_second,mean_latency_ms with optional p95_latency_ms,p99_latency_ms.',
    );
  const allowed = [
    'requests_per_second',
    'mean_latency_ms',
    'p95_latency_ms',
    'p99_latency_ms',
  ];
  if (
    curve &&
    (headers.some((h) => !allowed.includes(h)) ||
      new Set(headers).size !== headers.length)
  )
    throw new Error('Unexpected or duplicate CSV column.');
  const parsed = rows.map((row, i) => {
    if (row.length !== headers.length)
      throw new Error(`CSV row ${i + 2}: column count mismatch.`);
    return row.map((value, column) => {
      if (!value.trim() && headers[column]!.startsWith('p')) return undefined;
      const n = Number(value);
      if (!value.trim() || !Number.isFinite(n) || n < 0 || (samples && n === 0))
        throw new Error(
          `CSV row ${i + 2}: ${headers[column]} must be a valid ${samples ? 'positive' : 'nonnegative'} number.`,
        );
      return n;
    });
  });
  const next = structuredClone(profile);
  if (samples)
    next.serviceTime = {
      kind: 'empirical',
      samplesMs: parsed.map((r) => r[0]!),
    };
  else
    next.capacityCurve = parsed.map((row) => ({
      requestsPerSecond: row[0]!,
      meanLatencyMs: row[1]!,
      p95LatencyMs: headers.includes('p95_latency_ms')
        ? row[headers.indexOf('p95_latency_ms')]
        : undefined,
      p99LatencyMs: headers.includes('p99_latency_ms')
        ? row[headers.indexOf('p99_latency_ms')]
        : undefined,
    }));
  return PerformanceProfileSchema.parse(next);
}
