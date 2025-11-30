import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { PrismaClient, Role } from '../generated/prisma/client';
import * as bcrypt from 'bcrypt';
import * as dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.DATABASE_URL || '';
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@afip-hub.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123!';

  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  // Create admin user
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      password: hashedPassword,
      role: Role.ADMIN,
    },
  });

  console.log('Admin user created:', admin.email);

  // Create subadmin user (optional)
  const subadminEmail = process.env.SUBADMIN_EMAIL || 'subadmin@afip-hub.com';
  const subadminPassword = process.env.SUBADMIN_PASSWORD || 'Subadmin123!';

  const hashedSubadminPassword = await bcrypt.hash(subadminPassword, 10);

  const subadmin = await prisma.user.upsert({
    where: { email: subadminEmail },
    update: {},
    create: {
      email: subadminEmail,
      password: hashedSubadminPassword,
      role: Role.SUBADMIN,
    },
  });

  console.log('Subadmin user created:', subadmin.email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

