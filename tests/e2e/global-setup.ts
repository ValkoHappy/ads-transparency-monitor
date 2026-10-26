import { prisma } from "@ad-monitor/db";
import { seedDemoData } from "../../scripts/seed-demo-data";

export default async function globalSetup() {
  await seedDemoData(prisma);
  await prisma.$disconnect();
}
