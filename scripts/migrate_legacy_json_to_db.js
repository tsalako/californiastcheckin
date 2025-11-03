// migrate_legacy_json_to_db.js (inline pass fields on User)
// Usage:
// node migrate_legacy_json_to_db.js --dir ./pathToLegacy // OR
// node migrate_legacy_json_to_db.js --bucket your-bucket --prefix optional/path --dry
// node migrate_legacy_json_to_db.js --bucket csd-data --prefix meta/ --dry

const { prisma } = require("../utils/db");
const fs = require("fs");
const path = require("path");

// Emails that should be assigned role = house
const HOUSE_EMAILS = new Set([
    "tsalako12@gmail.com", 
    "testtacocat@gmail.com", 
    "vic.anibarro@gmail.com",
    "mitchell.celicious@gmail.com"]);

const FALLBACK_EMAILS = {
  // Example entry (you'll fill these out)
  "tristyn_emily_gmail_com": "tristyn.emily@gmail.com",
  "kstamborski_gmail_com": "kstamborski@gmail.com",
  // Add more here:
  // "somefilename": "user@example.com",
};

async function readLocalDir(dir) {
  const out = { metas: [] };
  const files = fs.readdirSync(dir);
  for (const f of files) {
    if (f.endsWith(".json")) {
      const json = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      out.metas.push(json);
    }
  }
  return out;
}

async function readFromGCS(bucket, prefix) {
  const { Storage } = require("@google-cloud/storage");
  const storage = new Storage();
  const out = { metas: [] };
  const [files] = await storage.bucket(bucket).getFiles({ prefix });
  for (const file of files) {
    const name = file.name;
    if (name.endsWith(".json")) {
      const [buf] = await storage.bucket(bucket).file(name).download();
      out.metas.push(JSON.parse(buf.toString("utf8")));
    }
  }
  return out;
}

function pstDayKey(ms) {
  const dt = new Date(ms);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(dt)
    .reduce((m, p) => ((m[p.type] = p.value), m), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

async function upsertUserWithPass({ email, name, meta, isDry }) {
  if (!email) return null;

  // Map legacy to inline fields
  const serialNumber =
    meta.serialNumber || meta.appleSerial || meta.appleSerialNumber || null;
  const authenticationToken =
    meta.authenticationToken ||
    meta.appleAuthToken ||
    meta.appleAuthTokenId ||
    null;
  const passTypeIdentifier = meta.passTypeIdentifier || null;
  const teamIdentifier = meta.teamIdentifier || null;
  const createdAtDefault = new Date(`2025-08-06T10:00:00`);
  const createdAt = meta.createTime ? new Date(meta.createTime) : createdAtDefault;

  const role = HOUSE_EMAILS.has((email || "").toLowerCase())
    ? "house"
    : undefined;
  const data = {
    ...(name ? { name } : {}),
    ...(role ? { role } : {}),
    ...(serialNumber ? { serialNumber } : {}),
    ...(authenticationToken ? { authenticationToken } : {}),
    ...(passTypeIdentifier ? { passTypeIdentifier } : {}),
    ...(teamIdentifier ? { teamIdentifier } : {}),
    ...(createdAt ? { createdAt } : {}),
  };

  if (isDry) {
    return { id: "dry-user", email, ...data };
  }

  // Prefer upsert by email
  return await prisma.user.upsert({
    where: { email },
    update: data,
    create: { email, ...data },
  });
}

async function upsertDevices({ userId, devices = [], isDry }) {
  for (const d of Array.isArray(devices) ? devices : []) {
    const deviceLibraryIdentifier = d.deviceLibraryIdentifier || d.dli || null;
    const pushToken = d.pushToken || d.token || null;
    if (!deviceLibraryIdentifier) continue;

    if (isDry) continue;

    const existing = await prisma.device.findUnique({
      where: { deviceLibraryIdentifier },
    });
    if (existing) {
      await prisma.device.update({
        where: { deviceLibraryIdentifier },
        data: {
          userId,
          ...(pushToken ? { pushToken } : {}),
        },
      });
    } else {
      await prisma.device.create({
        data: {
          userId,
          deviceLibraryIdentifier,
          pushToken: pushToken ?? "",
        },
      });
    }
  }
}

async function writeVisits({ userId, visitTimestamps = [], isDry }) {
  const tsArray = Array.isArray(visitTimestamps) ? visitTimestamps : [];
  const seenDay = new Set();
  let visitsCreated = 0;
  for (const ms of tsArray) {
    const key = pstDayKey(ms);
    if (seenDay.has(key)) continue; // de-dupe by PST day
    seenDay.add(key);
    if (!isDry) {
      await prisma.visit.create({
        data: {
          userId,
          occurredAt: new Date(ms), // renamed column
          kind: "self",
        },
      });
    }
    visitsCreated++;
  }
  return visitsCreated;
}

async function main() {
  const args = process.argv.slice(2);
  const getArg = (k, d) => {
    const i = args.indexOf(k);
    return i === -1 ? d : args[i + 1];
  };
  const isDry = args.includes("--dry");
  const dir = getArg("--dir", null);
  const bucket = getArg("--bucket", null);
  const prefix = getArg("--prefix", "");
  if (!dir && !bucket) {
    console.error("Provide --dir=... OR --bucket=... [--prefix=...]");
    process.exit(1);
  }

  const src = dir ? await readLocalDir(dir) : await readFromGCS(bucket, prefix);
  const metas = src.metas || [];

  let usersUpserted = 0;
  let visitsCreated = 0;
  let devicesTouched = 0; // approximate

  const emailSet = new Set();

  for (const meta of metas) {
    let email = meta.email || meta.userEmail || null;
    if (!email && meta.serialNumber) {
        const key = meta.serialNumber;
        if (FALLBACK_EMAILS[key]) email = FALLBACK_EMAILS[key];
    }
    const name = meta.name || meta.userName || null;

    if (email) emailSet.add(email.toLowerCase());

    const user = await upsertUserWithPass({ email, name, meta, isDry });
    if (user) usersUpserted++;

    // visits
    if (user && user.id) {
      visitsCreated += await writeVisits({
        userId: user.id,
        visitTimestamps: meta.visitTimestamps,
        isDry,
      });

      // devices
      if (Array.isArray(meta.devices) && meta.devices.length) {
        await upsertDevices({ userId: user.id, devices: meta.devices, isDry });
        devicesTouched += meta.devices.length;
      }
    }
  }

  console.log(
    JSON.stringify(
      { usersUpserted, visitsCreated, devicesTouched, dry: isDry },
      null,
      2
    )
  );

  const allEmails = Array.from(emailSet).sort((a, b) => a.localeCompare(b));
  console.log("\n=== All Emails (Alphabetical) ===");
    for (const email of allEmails) console.log(email);
    console.log("=================================\n");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
