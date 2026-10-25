import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('extractor syntax CI keeps Python 3.8 on its supported runner instead of dropping the check', () => {
  const workflow = readFileSync(new URL('../.github/workflows/local-extract-python.yml', import.meta.url), 'utf8');
  assert.match(workflow, /runs-on: ubuntu-24\.04/);
  assert.match(workflow, /python-version: '3\.8'/);
  assert.match(workflow, /python -m compileall -q -f tools\/local-extract/);
});
