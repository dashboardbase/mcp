import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatSetupFileResult, formatWidgetResponseResult } from '../dist/format.js';

test('valid setup file reports no errors', () => {
  const text = formatSetupFileResult({ valid: true, errors: [], warnings: [] });
  assert.equal(text, 'Valid setup file — no errors.');
});

test('setup file errors align path, position and message', () => {
  const text = formatSetupFileResult({
    valid: false,
    errors: [
      { path: 'mappings[0]', field: 'type', message: 'Unknown widget type "guage"', line: 14, column: 9 },
      { path: 'mappings[1]', field: 'path', message: 'Path must start with "/"', line: 22, column: 5 },
    ],
    warnings: [{ path: 'mappings[2]', message: 'No refreshInterval set' }],
  });

  assert.equal(
    text,
    [
      'Invalid setup file — 2 errors, 1 warning',
      '',
      '  mappings[0].type  14:9  Unknown widget type "guage"',
      '  mappings[1].path  22:5  Path must start with "/"',
      '',
      '  warning  mappings[2]  No refreshInterval set',
    ].join('\n'),
  );
});

test('singular nouns are used for a single error', () => {
  const text = formatSetupFileResult({ valid: false, errors: [{ path: 'name', message: 'Required' }] });
  assert.match(text, /^Invalid setup file — 1 error$/m);
});

test('missing line and column collapse the position column', () => {
  const text = formatSetupFileResult({
    valid: false,
    errors: [{ path: 'name', field: 'name', message: 'Required' }],
  });
  assert.equal(text, ['Invalid setup file — 1 error', '', '  name  Required'].join('\n'));
});

test('a line without a column still renders', () => {
  const text = formatSetupFileResult({
    valid: false,
    errors: [{ path: 'name', message: 'Required', line: 7, column: null }],
  });
  assert.match(text, /  name {2}7 {2}Required/);
});

test('absent fields never render as undefined', () => {
  const text = formatSetupFileResult({ valid: false, errors: [{}, { message: 'Something is wrong' }] });
  assert.doesNotMatch(text, /undefined/);
  assert.match(text, /Something is wrong/);
});

test('field is not duplicated when the path already ends with it', () => {
  const text = formatSetupFileResult({
    valid: false,
    errors: [{ path: 'mappings[0].type', field: 'type', message: 'Unknown widget type' }],
  });
  assert.match(text, /mappings\[0]\.type {2}Unknown widget type/);
  assert.doesNotMatch(text, /type\.type/);
});

test('valid widget response names the widget type', () => {
  const text = formatWidgetResponseResult({ valid: true, widgetType: 'kpi', errors: [] });
  assert.equal(text, 'Valid kpi response — no errors.');
});

test('widget response falls back when the type is missing', () => {
  const text = formatWidgetResponseResult({ valid: true, errors: [] });
  assert.equal(text, 'Valid widget response — no errors.');
});

test('widget response errors render path and message', () => {
  const text = formatWidgetResponseResult({
    valid: false,
    widgetType: 'kpi',
    errors: [
      { path: '$.data.header', message: 'Required property "title" is missing' },
      { path: '$.data.value', message: 'Expected number, got string' },
    ],
  });

  assert.equal(
    text,
    [
      'Invalid kpi response — 2 errors',
      '',
      '  $.data.header  Required property "title" is missing',
      '  $.data.value   Expected number, got string',
    ].join('\n'),
  );
});

test('warnings on a widget response render even though the schema omits them today', () => {
  const text = formatWidgetResponseResult({
    valid: true,
    widgetType: 'kpi',
    errors: [],
    warnings: [{ path: '$.title', message: 'No title set' }],
  } as Parameters<typeof formatWidgetResponseResult>[0]);

  assert.match(text, /1 warning/);
  assert.match(text, /warning {2}\$\.title {2}No title set/);
});

test('a malformed result does not throw', () => {
  const text = formatSetupFileResult({ valid: false, errors: 'nope', warnings: null } as never);
  assert.equal(text, 'Invalid setup file');
});
