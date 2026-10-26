import { prisma } from "@ad-monitor/db";

export async function clearTestDatabase() {
  const target = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || target.pathname !== "/ads_monitor_verify") {
    throw new Error("Integration tests require the local ads_monitor_verify database.");
  }
  await prisma.scanEvent.deleteMany();
  await prisma.scan.deleteMany();
  await prisma.scanJob.deleteMany();
  await prisma.rawApiSnapshot.deleteMany();
  await prisma.creativeCountry.deleteMany();
  await prisma.creativeAsset.deleteMany();
  await prisma.creative.deleteMany();
  await prisma.app.deleteMany();
  await prisma.advertiser.deleteMany();
  await prisma.systemSettings.deleteMany();
  await prisma.user.deleteMany();
}
