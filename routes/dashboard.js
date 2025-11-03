const express = require("express");
const router = express.Router();
const { eachDayOfInterval, format } = require("date-fns");
const { prisma, PrismaSql } = require("../utils/db");
const { isProd } = require("../utils/env");

function getDateRange(range) {
  const now = new Date();
  const tz = "America/Los_Angeles";
  const y = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
  }).format(now);
  const m = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    month: "2-digit",
  }).format(now);
  const d = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    day: "2-digit",
  }).format(now);
  const todayStr = `${y}-${m}-${d}`;

  function startOfWeekPST() {
    const today = new Date(`${todayStr}T00:00:00`);
    const dow = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
    }).format(now);
    const idx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(dow);
    const start = new Date(today);
    start.setDate(start.getDate() - idx);
    const ys = start.getFullYear().toString().padStart(4, "0");
    const ms = (start.getMonth() + 1).toString().padStart(2, "0");
    const ds = start.getDate().toString().padStart(2, "0");
    return `${ys}-${ms}-${ds}`;
  }

  if (range === "today") return { start: todayStr, end: todayStr };
  if (range === "yesterday") {
    const t = new Date(`${todayStr}T00:00:00`);
    t.setDate(t.getDate() - 1);
    const ys = t.getFullYear().toString().padStart(4, "0");
    const ms = (t.getMonth() + 1).toString().padStart(2, "0");
    const ds = t.getDate().toString().padStart(2, "0");
    const yst = `${ys}-${ms}-${ds}`;
    return { start: yst, end: yst };
  }
  if (range === "thisWeek") {
    return { start: startOfWeekPST(), end: todayStr };
  }
  if (range === "thisQuarter") {
    const q0 = Math.floor((parseInt(m) - 1) / 3) * 3 + 1;
    const ms = q0.toString().padStart(2, "0");
    return { start: `${y}-${ms}-01`, end: todayStr };
  }
  if (range === "thisYear") return { start: `${y}-01-01`, end: todayStr };
  // default thisMonth
  return { start: `${y}-${m}-01`, end: todayStr };
}

// Compute "this/last" × "day/week/month/quarter/year" in PST
function getComboRange(mode = "this", period = "month") {
  const tz = "America/Los_Angeles";
  const now = new Date();

  // PST calendar parts
  const y = +new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
  }).format(now);
  const m = +new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    month: "2-digit",
  }).format(now);
  const d = +new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    day: "2-digit",
  }).format(now);

  // Helpers to build YYYY-MM-DD
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (Y, M, D) => `${String(Y).padStart(4, "0")}-${pad(M)}-${pad(D)}`;

  const dateObj = new Date(`${y}-${pad(m)}-${pad(d)}T00:00:00`);
  const copy = (dt) => new Date(dt.getTime());

  const startOfWeek = (dt) => {
    const out = copy(dt);
    const dow = out.getDay(); // Sun=0
    out.setDate(out.getDate() - dow);
    return out;
    // (If you need Monday-start weeks, add +6/-? here.)
  };

  function thisDay() {
    const s = dateObj;
    return {
      start: ymd(s.getFullYear(), s.getMonth() + 1, s.getDate()),
      end: ymd(s.getFullYear(), s.getMonth() + 1, s.getDate()),
    };
  }
  function thisWeek() {
    const s = startOfWeek(dateObj);
    return {
      start: ymd(s.getFullYear(), s.getMonth() + 1, s.getDate()),
      end: ymd(
        dateObj.getFullYear(),
        dateObj.getMonth() + 1,
        dateObj.getDate()
      ),
    };
  }
  function thisMonth() {
    return { start: ymd(y, m, 1), end: ymd(y, m, new Date(y, m, 0).getDate()) };
  }
  function thisQuarter() {
    const q0 = Math.floor((m - 1) / 3) * 3 + 1;
    const endDay = new Date(y, q0 + 3, 0).getDate();
    return { start: ymd(y, q0, 1), end: ymd(y, q0 + 2, endDay) };
  }
  function thisYear() {
    return { start: `${y}-01-01`, end: `${y}-12-31` };
  }

  function prevDay() {
    const s = new Date(dateObj);
    s.setDate(s.getDate() - 1);
    const sd = ymd(s.getFullYear(), s.getMonth() + 1, s.getDate());
    return { start: sd, end: sd };
  }
  function prevWeek() {
    const end = new Date(startOfWeek(dateObj));
    end.setDate(end.getDate() - 1);
    const start = startOfWeek(end);
    return {
      start: ymd(start.getFullYear(), start.getMonth() + 1, start.getDate()),
      end: ymd(end.getFullYear(), end.getMonth() + 1, end.getDate()),
    };
  }
  function prevMonth() {
    const nm = m === 1 ? 12 : m - 1;
    const ny = m === 1 ? y - 1 : y;
    return {
      start: ymd(ny, nm, 1),
      end: ymd(ny, nm, new Date(ny, nm, 0).getDate()),
    };
  }
  function prevQuarter() {
    const q0 = Math.floor((m - 1) / 3) * 3 + 1;
    const pm = q0 - 3;
    const ny = pm < 1 ? y - 1 : y;
    const pm2 = ((pm + 11) % 12) + 1;
    const endDay = new Date(ny, pm2 + 1, 0).getDate();
    return { start: ymd(ny, pm2, 1), end: ymd(ny, pm2 + 2, endDay) };
  }
  function prevYear() {
    return { start: `${y - 1}-01-01`, end: `${y - 1}-12-31` };
  }

  const maps = {
    this: {
      day: thisDay,
      week: thisWeek,
      month: thisMonth,
      quarter: thisQuarter,
      year: thisYear,
    },
    last: {
      day: prevDay,
      week: prevWeek,
      month: prevMonth,
      quarter: prevQuarter,
      year: prevYear,
    },
  };

  const fn = maps[mode]?.[period] || maps.this.month;
  return fn();
}

function parseDateAsPST(dateStr) {
  // Parse date parts as numeric
  const [year, month, day] = dateStr.split("-").map(Number);

  // Construct PST-native calendar date (no time shifting)
  return new Date(year, month - 1, day, 0, 0, 0);
}

function getChartLabelsForRange(startStr, endStr) {
  const start = parseDateAsPST(startStr);
  const end = parseDateAsPST(endStr);

  return eachDayOfInterval({ start, end }).map((date) =>
    format(date, "yyyy-MM-dd")
  );
}

router.get("/dashboard", async (req, res) => {
  try {
    let { start, end, range, mode, period, all } = req.query;

    // "All time" (no date filter)
    const isAll = all === "1" || all === "true";

    // Priority: if all-time, skip dates; else if mode/period, compute combo; else if manual, use them; else fallback to current default
    if (!isAll) {
      if (mode && period) {
        const combo = getComboRange(mode, period);
        start = combo.start;
        end = combo.end;
      } else if (!start || !end) {
        ({ start, end } = getDateRange(range || "thisMonth"));
      }
    } else {
      start = null;
      end = null;
    }

    // For charts, we still need labels; if all-time, we can show the last 90 days to keep the chart usable
    const labels =
      !isAll && start && end ? getChartLabelsForRange(start, end) : null;

    const startDt = start ? new Date(start + "T00:00:00") : null;
    const endDt = end ? new Date(end + "T23:59:59.999") : null;

    // Helpers: conditionally apply BETWEEN only when we have a range
    const betweenVisit = isAll
      ? PrismaSql.sql`TRUE`
      : PrismaSql.sql`
          (
            (v."occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')
            BETWEEN ${startDt}::timestamp AND ${endDt}::timestamp
          )
        `;

    const betweenUser = isAll
      ? PrismaSql.sql`TRUE`
      : PrismaSql.sql`
          (
            (u."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')
            BETWEEN ${startDt}::timestamp AND ${endDt}::timestamp
          )
        `;

    const leaderboardRows = await prisma.$queryRaw`
      SELECT
        u."id",
        COALESCE(u."name",u."email") AS name,
        COUNT(v.*)::int AS visits
      FROM "User" AS u
      LEFT JOIN "Visit" AS v
        ON v."userId" = u."id"
      AND ${betweenVisit}
      AND v."kind" = 'self'
      WHERE ( ${isProd()} = false OR COALESCE(u."role",'user') <> 'house')
      GROUP BY u."id"
      ORDER BY visits DESC, name ASC
      LIMIT 100;
    `;
    const leaderboard = leaderboardRows.map((u, idx) => ({
      rank: idx + 1,
      name: u.name,
      visits: u.visits,
    }));

    const visitsRows = await prisma.$queryRaw`
      SELECT
        to_char(((v."occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date), 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS count
      FROM "Visit" AS v
      LEFT JOIN "User" AS u ON u."id" = v."userId"
      WHERE
        ${betweenVisit}
        AND (
          v."userId" IS NULL
          OR ( ${isProd()} = false OR COALESCE(u."role",'user') <> 'house' )
        )
      GROUP BY day
      ORDER BY day;
    `;
    let visitsPerDay = {};
    for (const r of visitsRows) visitsPerDay[r.day] = r.count;
    if (labels) {
      visitsPerDay = Object.fromEntries(
        labels.map((date) => [date, visitsPerDay[date] || 0])
      );
    }

    const passesRows = await prisma.$queryRaw`
      SELECT
        to_char( ((u."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')::date), 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS count
      FROM "User" AS u
      WHERE ${betweenUser}
        AND ( ${isProd()} = false OR COALESCE(u."role",'user') <> 'house')
      GROUP BY day
      ORDER BY day;
    `;
    let passesPerDay = {};
    for (const r of passesRows) passesPerDay[r.day] = r.count;
    if (labels) {
      passesPerDay = Object.fromEntries(
        labels.map((date) => [date, passesPerDay[date] || 0])
      );
    }

    const updateLogRows = await prisma.$queryRaw`
      SELECT
        COALESCE(u."name", u."email", 'Anonymous') AS name,
        v."occurredAt" AS update_time,
        CASE
          WHEN u."id" IS NULL THEN to_char((v."occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles'),
                'Dy, Mon DD, YYYY')
          ELSE to_char((v."occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles'),
                'Dy, Mon DD, YYYY, HH12:MI AM')
        END AS update_time_str,
        CASE
          WHEN u."id" IS NULL THEN false
          ELSE ( DATE(v."occurredAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles')
                <> DATE(u."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Los_Angeles') )
        END AS is_update,
        v."kind" AS visit_kind,
        CASE
          WHEN u."id" IS NULL THEN false
          ELSE EXISTS (SELECT 1 FROM "Device" d WHERE d."userId" = u."id")
        END AS has_devices
      FROM "Visit" AS v
      LEFT JOIN "User" AS u ON u."id" = v."userId"
      WHERE
        ${betweenVisit}
        AND (
          v."userId" IS NULL
          OR ( ${isProd()} = false OR COALESCE(u."role",'user') <> 'house' )
        )
      ORDER BY update_time DESC
      LIMIT 200;
  `;
    const updateLog = updateLogRows.map((r) => ({
      name: r.name,
      updateTime: r.update_time_str,
      isUpdate: !!r.is_update,
      hasDevices: !!r.has_devices,
      visitKind: r.visit_kind || null,
    }));

    const hostAttrRows = await prisma.$queryRaw`
      SELECT
        h."id" AS host_id,
        COALESCE(h."name",h."email") AS host_name,
        COUNT(v.*)::int AS guest_visits
      FROM "Visit" AS v
      JOIN "User"  AS g  ON g."id"  = v."userId"
      JOIN "GuestHost" gh   ON gh."guestId" = g."id"
      JOIN "User"  AS h  ON h."id"  = gh."hostId"
      WHERE ${betweenVisit}
        AND COALESCE(g."role",'user') <> 'house'
      GROUP BY h."id", host_name
      ORDER BY guest_visits DESC;
    `;
    const hostAttribution = hostAttrRows.map((r) => ({
      hostId: r.host_id,
      hostName: r.host_name,
      visits: r.guest_visits,
    }));

    res.render("dashboard", {
      leaderboard,
      visitsPerDay,
      passesPerDay,
      updateLog,
      hostAttribution,
      mode: mode || "this",
      period: period || "month",
      all: isAll || false,
      start,
      end,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send("Dashboard error");
  }
});

module.exports = router;
