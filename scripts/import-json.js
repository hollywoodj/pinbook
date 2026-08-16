#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { getDefaultUser, importFromJson } = require('../lib/db');

const file = process.argv[2] || path.join(__dirname, '..', 'sample', 'bookmarks.json');

if (!fs.existsSync(file)) {
  console.error(`File not found: ${file}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const user = getDefaultUser();
const result = importFromJson(user.id, data);

console.log(`Imported ${result.imported} bookmarks (${result.skipped} skipped) from ${file}`);
