const LEVELS = [
  {
    visits: 0,
    name: "Sleepless",
    image: "sleepless.png",
    backgroundColor: "#1e293b",
    foregroundColor: "#f8fafc",
  },
  {
    visits: 2,
    name: "Dozer",
    image: "dozer.png",
    backgroundColor: "#334155",
    foregroundColor: "#e2e8f0",
  },
  {
    visits: 4,
    name: "Snoozer",
    image: "snoozer.png",
    backgroundColor: "#475569",
    foregroundColor: "#f1f5f9",
  },
  {
    visits: 8,
    name: "Dreamer",
    image: "dreamer.png",
    backgroundColor: "#7c3aed",
    foregroundColor: "#ffffff",
  },
  {
    visits: 12,
    name: "Deep Sleeper",
    image: "deep-sleeper.png",
    backgroundColor: "#4b5563",
    foregroundColor: "#f9fafb",
  },
  {
    visits: 18,
    name: "Power Napper",
    image: "power-napper.png",
    backgroundColor: "#10b981",
    foregroundColor: "#ffffff",
  },
  {
    visits: 26,
    name: "REM Master",
    image: "rem-master.png",
    backgroundColor: "#1d4ed8",
    foregroundColor: "#ffffff",
  },
  {
    visits: 36,
    name: "Lucid Drifter",
    image: "lucid-drifter.png",
    backgroundColor: "#8b5cf6",
    foregroundColor: "#ffffff",
  },
  {
    visits: 50,
    name: "Sleep Elite",
    image: "sleep-elite.png",
    backgroundColor: "#0f172a",
    foregroundColor: "#ffffff",
  },
  {
    visits: 75,
    name: "Nap God",
    image: "nap-god.png",
    backgroundColor: "#000000",
    foregroundColor: "#facc15",
  },
];

function getLevelDetails(visitCount) {
  let currentLevel = LEVELS[0];
  for (const level of LEVELS) {
    if (visitCount >= level.visits) {
      currentLevel = level;
    } else {
      break;
    }
  }
  return currentLevel;
}

module.exports = { getLevelDetails };
