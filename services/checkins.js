const { prisma } = require("../utils/db");
const { getOrCreateUserByEmail } = require("../services/users");
const { isProd } = require("../utils/env");

function pstDayBounds(date = new Date()) {
  const now = new Date(date);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(now)
    .reduce((m, p) => ((m[p.type] = p.value), m), {});
  const start = new Date(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    0,
    0,
    0,
    0
  );
  const end = new Date(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    23,
    59,
    59,
    999
  );
  return { start, end };
}

async function visitsCount(userId) {
  return prisma.visit.count({ where: { userId } });
}

async function alreadyCheckedInToday(userId) {
  const { start, end } = pstDayBounds();
  console.log("Start" + start + " End: " + end);
  const hit = await prisma.visit.findFirst({
    where: { userId, occurredAt: { gte: start, lte: end } },
  });
  return !!hit;
}

async function recordVisit({ userId, kind = "self" }) {
  return prisma.visit.create({
    data: {
      userId,
      kind,
    },
  });
}

async function addRetroAnonymousVisit({ occurredAt, note }) {
  return prisma.visit.create({
    data: {
      userId: null,
      occurredAt: occurredAt,
      kind: "retro",
      note: note || null,
    },
  });
}

async function addRetroVisitForUser({ email, name, occurredAt, note }) {
  const user = await getOrCreateUserByEmail(email, name);

  if (isProd() && (await alreadyCheckedInToday(user.id, occurredAt))) {
    throw new Error("You've already checked in today.");
  }

  return prisma.visit.create({
    data: {
      userId: user.id,
      occurredAt: occurredAt,
      kind: "retro",
      note: note || null,
    },
  });
}

async function addCompanions({ primaryUserId, count }) {
  const rows = Array.from({ length: count }, () => ({
    userId: null,
    kind: "companion",
    primaryUserId,
  }));

  return prisma.visit.createMany({ data: rows });
}

async function companionsAddedToday(primaryUserId) {
  const { start, end } = pstDayBounds();
  const count = await prisma.visit.count({
    where: {
      kind: "companion",
      primaryUserId,
      occurredAt: { gte: start, lte: end },
    },
  });
  return count > 0;
}

async function addCompanionsOncePerDay({ primaryUserId, count }) {
  if (!primaryUserId) throw new Error("primaryUserId required");
  if (await companionsAddedToday(primaryUserId)) {
    const err = new Error("companions_already_added_today");
    err.code = "COMPANIONS_ALREADY_TODAY";
    throw err;
  }
  return addCompanions({ primaryUserId, count });
}

module.exports = {
  visitsCount,
  alreadyCheckedInToday,
  recordVisit,
  addRetroAnonymousVisit,
  addRetroVisitForUser,
  addCompanions,
  companionsAddedToday,
  addCompanionsOncePerDay,
};
