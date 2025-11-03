const { prisma } = require("../utils/db");

async function upsertAppleDevice(userId, deviceLibraryIdentifier, pushToken) {
  return prisma.device.upsert({
    where: { deviceLibraryIdentifier },
    update: { pushToken },
    create: { userId, deviceLibraryIdentifier, pushToken },
  });
}

async function unregisterAppleDevice(deviceLibraryIdentifier) {
  return prisma.device.deleteMany({ where: { deviceLibraryIdentifier } });
}

async function getUserDevices(userId) {
  return prisma.device.findMany({ where: { userId } });
}

module.exports = { upsertAppleDevice, unregisterAppleDevice, getUserDevices };
