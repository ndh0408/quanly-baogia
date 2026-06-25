import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync, chmodSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Prisma 7: bắt buộc driver adapter (như src/db.ts). PrismaPg nhận connectionString (tự tạo pool).
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

function generatePassword() {
  // 16 chars URL-safe; mixes letters+numbers, enforces zod policy
  return randomBytes(12).toString("base64url").replace(/[_-]/g, "x") + "A1";
}

async function main() {
  const adminUsername = process.env.ADMIN_USERNAME || "admin";
  let adminPwd = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!adminPwd) {
    adminPwd = generatePassword();
    generated = true;
  }

  const existingAdmin = await prisma.user.findUnique({ where: { username: adminUsername } });
  if (existingAdmin) {
    console.log(`✓ Admin '${adminUsername}' đã tồn tại — bỏ qua tạo mới.`);
  } else {
    await prisma.user.create({
      data: {
        username: adminUsername,
        passwordHash: await bcrypt.hash(adminPwd, Number(process.env.BCRYPT_COST || 12)),
        displayName: process.env.ADMIN_DISPLAY_NAME || "Quản trị viên",
        role: "admin",
      },
    });

    if (generated) {
      // Write credentials to a gitignored local file instead of leaking to stdout / logs.
      const credPath = path.join(__dirname, "..", ".admin-credentials.local");
      const credContent =
        `# Generated at seed time — DO NOT COMMIT\n` +
        `# Read once, then change via /api/auth/change-password and delete this file.\n` +
        `ADMIN_USERNAME=${adminUsername}\n` +
        `ADMIN_PASSWORD=${adminPwd}\n`;
      writeFileSync(credPath, credContent, { mode: 0o600, flag: "wx" });
      try { chmodSync(credPath, 0o600); } catch {}
      console.log(`✓ Admin tạo thành công. Mật khẩu lưu tại .admin-credentials.local (chmod 600).`);
      console.log(`  Vui lòng đổi mật khẩu ngay và xóa file đó.`);
    } else {
      console.log(`✓ Admin '${adminUsername}' đã tạo theo ADMIN_PASSWORD từ env.`);
    }
  }

  const giaNguyen = await prisma.company.upsert({
    where: { code: "gia_nguyen" },
    create: {
      code: "gia_nguyen",
      name: "Công ty Gia Nguyễn",
      shortName: "Gia Nguyễn",
      quotePrefix: "GN",
      address: "34 Đào Trí, P.Phú Thuận, Q.7 TP.HCM",
      city: "TP. Hồ Chí Minh",
      phone: "0914291951",
    },
    update: { quotePrefix: "GN" },
  });
  console.log(`✓ Công ty: ${giaNguyen.name}`);

  await prisma.quoteTemplate.upsert({
    where: { code: "marico_decor" },
    create: {
      code: "marico_decor",
      name: "GN (không ngày)",
      companyId: giaNguyen.id,
      filePath: "templates/GN_KhongNgay.xlsx",
    },
    update: {
      name: "GN (không ngày)",
      companyId: giaNguyen.id,
      filePath: "templates/GN_KhongNgay.xlsx",
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
  // GN Banner (không ngày): cùng file/cách xuất GN không ngày, CHỈ khác cách đánh STT
  // (nhóm con đánh số 1,2,3; mục bên dưới không đánh số) — config gn_banner ở templateConfigs.js.
  await prisma.quoteTemplate.upsert({
    where: { code: "gn_banner" },
    create: {
      code: "gn_banner",
      name: "GN Banner (không ngày)",
      companyId: giaNguyen.id,
      filePath: "templates/GN_KhongNgay.xlsx",
    },
    update: {
      name: "GN Banner (không ngày)",
      companyId: giaNguyen.id,
      filePath: "templates/GN_KhongNgay.xlsx",
    },
  });
  console.log(`✓ Templates GN: 3`);

  // === Clofull company + its no-date template (new CLF.xls form) ===
  const clofull = await prisma.company.upsert({
    where: { code: "clofull" },
    create: {
      code: "clofull",
      name: "Công ty TNHH Colorfull",
      shortName: "Colorfull",
      quotePrefix: "CLF",
      address: "34 Đào Trí, P.Phú Thuận, Q.7 TP.HCM",
      city: "TP. Hồ Chí Minh",
      phone: "0914291951",
    },
    update: { quotePrefix: "CLF", shortName: "Colorfull" },
  });
  console.log(`✓ Công ty: ${clofull.name}`);

  await prisma.quoteTemplate.upsert({
    where: { code: "clofull_decor" },
    create: {
      code: "clofull_decor",
      name: "CLF (không ngày)",
      companyId: clofull.id,
      filePath: "templates/CLF_KhongNgay.xlsx",
    },
    update: {
      name: "CLF (không ngày)",
      companyId: clofull.id,
      filePath: "templates/CLF_KhongNgay.xlsx",
    },
  });
  console.log(`✓ Template CLF: 1`);

  // === Default notification channel preferences ===
  await prisma.setting.upsert({
    where: { key: "notif.channels" },
    create: { key: "notif.channels", value: { email: "important", telegram: "off" } },
    update: {},
  });
  console.log(`✓ Settings: notif.channels`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
