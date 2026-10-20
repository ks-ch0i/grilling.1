import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');

test('portrait orientation hides gameplay and shows the rotation notice', () => {
  assert.match(
    styles,
    /@media\s*\(orientation:\s*portrait\)[\s\S]*?body\.is-portrait #rotate-message\s*\{[^}]*\bdisplay\s*:\s*block\s*;/,
    'portrait mode should show the rotate notice',
  );
  assert.match(
    styles,
    /@media\s*\(orientation:\s*portrait\)[\s\S]*?body\.is-portrait #game\s*\{[^}]*\bdisplay\s*:\s*none\s*;/,
    'portrait mode should hide the game canvas',
  );
});
