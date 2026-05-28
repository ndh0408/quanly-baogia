import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const adminUsername = process.env.ADMIN_USERNAME || "admin";
  const adminPwd = process.env.ADMIN_PASSWORD || "admin123";

  const existingAdmin = await prisma.user.findUnique({ where: { username: adminUsername } });
  if (existingAdmin) {
    console.log(`✓ Admin '${adminUsername}' đã tồn tại, bỏ qua.`);
  } else {
    await prisma.user.create({
      data: {
        username: adminUsername,
        passwordHash: await bcrypt.hash(adminPwd, 10),
        displayName: process.env.ADMIN_DISPLAY_NAME || "Quản trị viên",
        role: "admin",
      },
    });
    console.log(`✓ Tạo admin: ${adminUsername} / ${adminPwd}`);
  }

  // Companies
  const giaNguyen = await prisma.company.upsert({
    where: { code: "gia_nguyen" },
    create: {
      code: "gia_nguyen",
      name: "Công ty Gia Nguyễn",
      shortName: "Gia Nguyễn",
      address: "34 Đào Trí, P.Phú Thuận, Q.7 TP.HCM",
      city: "TP. Hồ Chí Minh",
      phone: "0914291951",
    },
    update: {},
  });
  console.log(`✓ Công ty: ${giaNguyen.name}`);

  // Templates
  await prisma.quoteTemplate.upsert({
    where: { code: "marico_decor" },
    create: {
      code: "marico_decor",
      name: "GN (không ngày)",
      companyId: giaNguyen.id,
      filePath: "templates/Marico_Decor.xlsx",
    },
    update: {
      name: "GN (không ngày)",
      companyId: giaNguyen.id,
      filePath: "templates/Marico_Decor.xlsx",
    },
  });
  await prisma.quoteTemplate.upsert({
    where: { code: "unibenfood" },
    create: {
      code: "unibenfood",
      name: "GN (có ngày)",
      companyId: giaNguyen.id,
      filePath: "templates/Unibenfood.xlsx",
    },
    update: {
      name: "GN (có ngày)",
      companyId: giaNguyen.id,
      filePath: "templates/Unibenfood.xlsx",
    },
  });
  console.log(`✓ Templates: 2`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
