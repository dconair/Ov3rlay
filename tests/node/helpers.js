'use strict';
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const payloadDir = nodePath.join(__dirname, '..', '..', 'payload');
const tmpDir = (name) => fs.mkdtempSync(nodePath.join(os.tmpdir(), `dc-${name}-`));
const sandbox = (name = 't') => {
  const root = tmpDir(name);
  return { root, paths: { obsConfig: nodePath.join(root, 'OBS "Studio"'), appDir: nodePath.join(root, 'dc "onair"'), fontDir: nodePath.join(root, 'Fonts'), recDir: nodePath.join(root, 'Videos') } };
};
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
module.exports = { payloadDir, tmpDir, sandbox, readJson };
