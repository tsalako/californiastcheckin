const { prisma } = require("../utils/db");
const { isProd } = require("../utils/env");

function getLastQuarterBounds(now = new Date()) {
  const tz = "America/Los_Angeles";

  // PST calendar parts
  const y = +new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
  }).format(now);
  const m = +new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    month: "2-digit",
  }).format(now);
  // Helpers to build YYYY-MM-DD
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (Y, M, D) => `${String(Y).padStart(4, "0")}-${pad(M)}-${pad(D)}`;

  const q0 = Math.floor((m - 1) / 3) * 3 + 1;
  const pm = q0 - 3;
  const ny = pm < 1 ? y - 1 : y;
  const pm2 = ((pm + 11) % 12) + 1;
  const endDay = new Date(ny, pm2 + 1, 0).getDate();

  const quarterNum = Math.ceil(pm2 / 3);
  const quarterStr = `${ny}Q${quarterNum}`;
  return {
    start: ymd(ny, pm2, 1),
    end: ymd(ny, pm2 + 2, endDay),
    name: quarterStr,
  };
}

function getLastYearBounds(now = new Date()) {
  const tz = "America/Los_Angeles";

  // PST calendar parts
  const y =
    +new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
    }).format(now) - 1;
  const name = `${y}`;
  return { start: `${y}-01-01`, end: `${y}-12-31`, name };
}

async function buildParticipants({ start, end }) {
  const rows = await prisma.$queryRaw`
    SELECT u."id" as user_id, COALESCE(u."name", u."email") as name, COUNT(v.*)::int as entries
    FROM "User" u
    JOIN "Visit" v ON v."userId" = u."id"
    WHERE v."kind" = 'self'
      AND (
            (v."occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')
            BETWEEN ${start}::timestamp AND ${end}::timestamp
          )
      AND ( ${isProd()} = false OR COALESCE(u."role",'user') <> 'house' )
    GROUP BY u."id"
    HAVING COUNT(v.*) > 0
    ORDER BY entries DESC
  `;
  return rows.map((r) => ({
    userId: r.user_id,
    name: r.name,
    entries: Number(r.entries),
    remaining: Number(r.entries),
  }));
}

async function createRaffle({ rangeType, winnersTarget, nameOverride }) {
  const now = new Date();
  const bounds =
    rangeType === "last_year"
      ? getLastYearBounds(now)
      : getLastQuarterBounds(now);
  const start = new Date(bounds.start + "T00:00:00"),
    end = new Date(bounds.end + "T23:59:59.999");
  const defaultName = bounds.name;
  const name =
    nameOverride && nameOverride.trim() ? nameOverride.trim() : defaultName;

  const participants = await buildParticipants({ start, end });
  const totalEntries = participants.reduce((a, b) => a + b.entries, 0);

  const raffle = await prisma.raffle.create({
    data: {
      name,
      rangeType,
      start,
      end,
      winnersTarget: Number(winnersTarget || 1),
      totalEntries,
      participants: {
        create: participants.map((p) => ({
          userId: p.userId,
          name: p.name,
          entries: p.entries,
          remaining: p.remaining,
        })),
      },
    },
    include: { participants: true, winners: true },
  });

  return raffle;
}

async function getRaffle(id) {
  return prisma.raffle.findUnique({
    where: { id },
    include: { participants: true, winners: { orderBy: { drawOrder: "asc" } } },
  });
}

function pickWeighted(participants) {
  const pool = participants.filter((p) => p.remaining > 0);
  const total = pool.reduce((a, b) => a + b.remaining, 0);
  if (total <= 0) return null;
  let r = Math.random() * total;
  for (const p of pool) {
    if (r < p.remaining) return p;
    r -= p.remaining;
  }
  return pool[pool.length - 1];
}

async function drawWinner(raffleId) {
  const raffle = await prisma.raffle.findUnique({
    where: { id: raffleId },
    include: { participants: true, winners: true },
  });
  if (!raffle) throw new Error("raffle_not_found");
  const already = raffle.winners.length;
  if (already >= raffle.winnersTarget) {
    const e = new Error("RAFFLE_COMPLETE");
    e.code = "RAFFLE_COMPLETE";
    throw e;
  }
  const pick = pickWeighted(raffle.participants);
  if (!pick) {
    const e = new Error("NO_ENTRIES");
    e.code = "NO_ENTRIES";
    throw e;
  }
  const order = already + 1;
  const [, winner] = await prisma.$transaction([
    prisma.raffleParticipant.update({
      where: { id: pick.id },
      data: { remaining: 0 },
    }),
    prisma.raffleWinner.create({
      data: {
        raffleId,
        userId: pick.userId,
        name: pick.name,
        drawOrder: order,
      },
    }),
  ]);
  return winner;
}

async function listRaffles() {
  return prisma.raffle.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      rangeType: true,
      start: true,
      end: true,
      winnersTarget: true,
      totalEntries: true,
      createdAt: true,
    },
  });
}

module.exports = {
  createRaffle,
  getRaffle,
  drawWinner,
  listRaffles,
  getLastQuarterBounds,
  getLastYearBounds,
};
