#!/usr/bin/env node
/* eslint-disable no-console */
// node rename_pkpass.js --dry

const { PrismaClient } = require('@prisma/client');
const { Storage } = require('@google-cloud/storage');
const pLimit = require('p-limit');

const prisma = new PrismaClient();
const storage = new Storage(); // Uses GOOGLE_APPLICATION_CREDENTIALS / ADC

// ---------- CONFIG ----------
const BUCKET_NAME = 'csd-data';
const SRC_PREFIX = 'apple/passes/';
const DEST_PREFIX = 'apple/passes2/';
const CONCURRENCY = 10;
// ----------------------------

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry');
const OVERWRITE = argv.includes('--overwrite');

function sanitizeEmailForFilename(email) {
  // Your exact rule
  return email.replace(/[^\w-]/g, "_").replace(/\./g, "_");
}
function withPkpass(name) {
  return name.endsWith('.pkpass') ? name : `${name}.pkpass`;
}
function stripPrefix(s, prefix) {
  return s.startsWith(prefix) ? s.slice(prefix.length) : s;
}
function withoutExt(s) {
  const i = s.lastIndexOf('.');
  return i >= 0 ? s.slice(0, i) : s;
}
async function objectExists(fileRef) {
  const [exists] = await fileRef.exists();
  return !!exists;
}

async function main() {
  console.log(`Bucket: ${BUCKET_NAME}`);
  console.log(`Source prefix: ${SRC_PREFIX}`);
  console.log(`Dest   prefix: ${DEST_PREFIX}`);
  console.log(`Options: ${DRY_RUN ? '[DRY-RUN] ' : ''}${OVERWRITE ? '[OVERWRITE] ' : ''}`);
  console.log('');

  const bucket = storage.bucket(BUCKET_NAME);

  // --- 1) Load all source objects
  console.log('Listing pkpass files under source prefix…');
  const [files] = await bucket.getFiles({ prefix: SRC_PREFIX });
  const srcFiles = files.filter(f => f.name.toLowerCase().endsWith('.pkpass'));
  const srcSet = new Set(srcFiles.map(f => f.name)); // full GCS object paths
  // Map: base (sanitized-email, w/o .pkpass, w/o prefix) -> full object path
  const srcByBase = new Map();
  for (const f of srcFiles) {
    const base = withoutExt(stripPrefix(f.name, SRC_PREFIX));
    srcByBase.set(base, f.name);
  }
  console.log(`Found ${srcFiles.length} pkpass objects in ${SRC_PREFIX}`);
  console.log('');

  // --- 2) Load users
  const users = await prisma.user.findMany({
    select: { id: true, email: true },
    orderBy: { id: 'asc' },
  });
  console.log(`Loaded ${users.length} users`);

  // Build index of sanitized emails -> users (detect collisions)
  const usersBySafe = new Map(); // safe -> { users: [], emails: Set }
  for (const u of users) {
    const safe = sanitizeEmailForFilename((u.email || ''));
    const entry = usersBySafe.get(safe) || { users: [], emails: new Set() };
    entry.users.push(u);
    if (u.email) entry.emails.add(u.email);
    usersBySafe.set(safe, entry);
  }

  // Collisions report
  const collisions = [];
  for (const [safe, entry] of usersBySafe.entries()) {
    if (entry.users.length > 1) {
      collisions.push({ safe, count: entry.users.length, emails: [...entry.emails] });
    }
  }
  if (collisions.length) {
    console.warn('\n[WARN] Filename collisions detected (multiple users map to the same sanitized email base):');
    for (const c of collisions) {
      console.warn(`  ${c.safe}  <-- ${c.count} users (${c.emails.join(', ')})`);
    }
    console.warn('  The script will still attempt copies per-user; review outcomes closely.\n');
  }

  // --- 3) Process copies
  const limit = pLimit(CONCURRENCY);
  let copied = 0;
  let skippedExists = 0;
  let missingSrc = 0;
  let errors = 0;

  // Track which source objects got matched/consumed
  const consumedSrc = new Set();

  const tasks = users.map(user => limit(async () => {
    const safe = sanitizeEmailForFilename(user.email || '');
    const srcBase = safe; // no extension
    const srcName = srcByBase.get(srcBase); // full object name if exists
    const destName = DEST_PREFIX + withPkpass(user.id);

    if (!srcName) {
      missingSrc++;
      console.log(`MISS  - ${user.email} -> ${SRC_PREFIX}${withPkpass(srcBase)} (not found)`);
      return;
    }

    const srcFile = bucket.file(srcName);
    const destFile = bucket.file(destName);

    const destFound = await objectExists(destFile);
    if (destFound && !OVERWRITE) {
      skippedExists++;
      consumedSrc.add(srcName); // it matched a user, even if we skipped
      console.log(`SKIP  - ${destName} exists (use --overwrite to replace)`);
      return;
    }

    if (DRY_RUN) {
      consumedSrc.add(srcName);
      console.log(`DRY   - copy ${srcName}  ->  ${destName}`);
      return;
    }

    try {
      await srcFile.copy(destFile);
      consumedSrc.add(srcName);
      copied++;
      console.log(`OK    - ${srcName}  ->  ${destName}`);
    } catch (e) {
      errors++;
      console.error(`ERR   - ${srcName} -> ${destName}:`, e.message || e);
    }
  }));

  await Promise.all(tasks);

  // --- 4) Unmatched sources (no user maps to them)
  const unmatched = srcFiles
    .map(f => f.name)
    .filter(name => !consumedSrc.has(name)); // never matched to any user

  // --- 5) Summary
  console.log('\nSummary');
  console.log('-------');
  console.log(`Copied:                ${copied}`);
  console.log(`Skipped (exists):      ${skippedExists}`);
  console.log(`Missing source (user): ${missingSrc}`);
  console.log(`Errors:                ${errors}`);
  console.log(`Unmatched source objs: ${unmatched.length}`);

  if (unmatched.length) {
    console.log('\nUnmatched source files (no user email match):');
    unmatched.slice(0, 50).forEach(n => console.log(`  ${n}`));
    if (unmatched.length > 50) {
      console.log(`  ...and ${unmatched.length - 50} more`);
    }
    console.log('\nTip: re-run with `--report unmatched_sources.csv` to export the full list.');
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
