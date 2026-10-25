import { SDK_VERSION } from '../version';

declare const __dirname: string;
const { readFileSync } = require('fs');
const { join } = require('path');

it('SDK_VERSION matches package.json', () => {
  const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));
  expect(SDK_VERSION).toBe(pkg.version);
});
