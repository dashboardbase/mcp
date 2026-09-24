/**
 * Renders API validation results as text an agent can act on.
 *
 * Rule: show exactly what the API returned. Fields that are absent are omitted —
 * never printed as "undefined", never replaced with a guess. The API owns the
 * diagnosis, so richer messages shipped on the backend show up here for free.
 */

import type { SetupFileResult, SetupLinkResult, WidgetResponseResult } from './api.js';

interface Row {
  label: string;
  position: string;
  message: string;
}

export function formatSetupFileResult(result: SetupFileResult): string {
  const errors = asArray(result.errors);
  const warnings = asArray(result.warnings);

  const errorRows: Row[] = errors.map((error) => ({
    label: joinPathAndField(asText(error.path), asText(error.field)),
    position: formatPosition(error.line, error.column),
    message: asText(error.message) ?? '',
  }));

  const warningRows: Row[] = warnings.map((warning) => ({
    label: asText(warning.path) ?? '',
    position: '',
    message: asText(warning.message) ?? '',
  }));

  return render({
    valid: result.valid === true,
    validHeadline: 'Valid setup file',
    invalidHeadline: 'Invalid setup file',
    errorRows,
    warningRows,
  });
}

export function formatWidgetResponseResult(result: WidgetResponseResult): string {
  const errors = asArray(result.errors);
  // Not in the documented schema today, but render it if the API starts sending it.
  const warnings = asArray((result as { warnings?: unknown }).warnings as SetupFileResult['warnings']);
  const widgetType = asText(result.widgetType);
  const subject = widgetType ? `${widgetType} response` : 'widget response';

  return render({
    valid: result.valid === true,
    validHeadline: `Valid ${subject}`,
    invalidHeadline: `Invalid ${subject}`,
    errorRows: errors.map((error) => ({
      label: asText(error.path) ?? '',
      position: formatPosition(
        (error as { line?: number | null }).line,
        (error as { column?: number | null }).column,
      ),
      message: asText(error.message) ?? '',
    })),
    warningRows: warnings.map((warning) => ({
      label: asText(warning.path) ?? '',
      position: '',
      message: asText(warning.message) ?? '',
    })),
  });
}

/**
 * A created link is followed by what the agent owes the user when handing it over —
 * a bare URL is not a handover, and the skill spells out the same points.
 */
export function formatSetupLinkResult(result: SetupLinkResult): string {
  if (!result.created) {
    const rows: Row[] = result.errors.map((error) => ({
      label: joinPathAndField(asText(error.path), asText(error.field)),
      position: formatPosition(error.line, error.column),
      message: asText(error.message) ?? '',
    }));
    const advice =
      result.reason === 'credentials_detected'
        ? 'Remove these fields and try again. Credentials are entered in the import flow, never in the file — do not work around this check.'
        : 'Fix the file (validate_setup_file shows every problem) and try again.';
    const headline = `No link created (${result.reason})${asText(result.title) ? ` — ${asText(result.title)}` : ''}`;
    return [headline, rows.length > 0 ? alignRows(rows) : undefined, advice]
      .filter((part): part is string => part !== undefined)
      .join('\n\n');
  }

  const url = asText(result.url);
  const expiresAt = asText(result.expiresAt ?? undefined);
  const lines = [url ? `Setup link created: ${url}` : 'Setup link created.'];
  if (expiresAt) lines.push(`Expires: ${expiresAt}`);
  lines.push(
    '',
    'When you give the user the link, tell them:',
    '- Opening it shows a preview of the dashboard and the hosts it pulls from; nothing is created until they confirm.',
    '- Credentials for their API are entered there, in the import flow — never in the file.',
    '- It expires in 48 hours. The file stays in their repo, and a fresh link can be made from it any time.',
    '- It works more than once, so they can forward it to teammates.',
    '- Anyone holding the link can read the file, so they should send it directly, not post it publicly.',
  );
  return lines.join('\n');
}

function render(input: {
  valid: boolean;
  validHeadline: string;
  invalidHeadline: string;
  errorRows: Row[];
  warningRows: Row[];
}): string {
  const { errorRows, warningRows } = input;
  const counts = [count(errorRows.length, 'error'), count(warningRows.length, 'warning')].filter(
    (part): part is string => part !== undefined,
  );

  // `valid` and an empty error list can disagree; trust `valid` for the verdict and
  // still show anything the API sent.
  if (input.valid && errorRows.length === 0 && warningRows.length === 0) {
    return `${input.validHeadline} — no errors.`;
  }

  const headline = input.valid
    ? `${input.validHeadline} — ${counts.join(', ')}`
    : `${input.invalidHeadline}${counts.length > 0 ? ` — ${counts.join(', ')}` : ''}`;

  const sections = [headline];
  if (errorRows.length > 0) sections.push(alignRows(errorRows));
  if (warningRows.length > 0) sections.push(alignRows(warningRows, 'warning  '));

  return sections.join('\n\n');
}

/** Pad the label and position columns so messages line up like compiler output. */
function alignRows(rows: Row[], prefix = ''): string {
  const labelWidth = Math.max(...rows.map((row) => row.label.length));
  const positionWidth = Math.max(...rows.map((row) => row.position.length));

  return rows
    .map((row) => {
      const cells = [`${prefix}${pad(row.label, labelWidth)}`];
      if (positionWidth > 0) cells.push(pad(row.position, positionWidth));
      const line = `  ${cells.join('  ')}  ${row.message}`;
      return line.trimEnd();
    })
    .join('\n');
}

/**
 * The API reports `path` and `field` separately (e.g. "mappings[0]" + "type").
 * Join them for a readable label, unless the path already ends with the field.
 */
function joinPathAndField(path: string | undefined, field: string | undefined): string {
  if (!path) return field ?? '';
  if (!field) return path;
  if (path === field || path.endsWith(`.${field}`) || path.endsWith(`[${field}]`)) return path;
  return `${path}.${field}`;
}

function formatPosition(line: unknown, column: unknown): string {
  const lineNumber = asNumber(line);
  const columnNumber = asNumber(column);
  if (lineNumber === undefined) return '';
  return columnNumber === undefined ? `${lineNumber}` : `${lineNumber}:${columnNumber}`;
}

function count(value: number, noun: string): string | undefined {
  if (value === 0) return undefined;
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
}

function asArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function pad(value: string, width: number): string {
  return value.padEnd(width);
}
