const { prisma } = require("../utils/db");

async function getOrCreateUserByEmail(email, name) {
  return prisma.user.upsert({
    where: { email },
    update: name ? { name } : {},
    create: { email, name },
  });
}

async function attachWalletIds(userId, ids) {
  return prisma.user.update({ where: { id: userId }, data: ids });
}

// Role helpers (optional scripting)
async function setUserRoleByEmail(email, role) {
  await prisma.user.updateMany({ where: { email }, data: { role } });
}

// GuestHost link helpers (optional scripting)
async function linkGuestToHost(guestId, hostId, note) {
  return prisma.guestHost.upsert({
    where: { guestId_hostId: { guestId, hostId } },
    update: { note },
    create: { guestId, hostId, note },
  });
}

async function unlinkGuestFromHost(guestId, hostId) {
  return prisma.guestHost.delete({
    where: { guestId_hostId: { guestId, hostId } },
  });
}

async function getHostsForGuest(guestId) {
  return prisma.guestHost.findMany({
    where: { guestId },
    include: { host: true },
  });
}

module.exports = {
  getOrCreateUserByEmail,
  attachWalletIds,
  setUserRoleByEmail,
  linkGuestToHost,
  unlinkGuestFromHost,
  getHostsForGuest,
};
