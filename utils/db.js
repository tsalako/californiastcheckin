const { PrismaClient, Prisma } = require("@prisma/client");
const prisma = new PrismaClient();
const PrismaSql = Prisma;
module.exports = { prisma, PrismaSql };
