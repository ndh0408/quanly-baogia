// Seed DỮ LIỆU DEMO phong phú cho môi trường DEV/STAGING — phủ MỌI workflow để review:
// nháp / không chốt / đã chốt (Hoá đơn→Thanh toán→Done) / PO+chứng từ (đỏ↔trắng) /
// Số HĐ HN (đỏ khi HN duyệt mà chưa có số) / luồng account Hà Nội (assigned/submitted/
// approved/rejected) / báo giá nhiều sheet / bảng nội bộ HCM-HN-Khách có duyệt theo hàng.
//
// AN TOÀN: chỉ chạy khi ALLOW_DEMO_SEED=1 (tránh seed nhầm vào prod). Idempotent: xoá sạch
// dữ liệu demo cũ (đánh dấu [DEMO] / demo_ / DEMOKH) rồi tạo lại.
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

// Raw client (KHÔNG có extension soft-delete của app) → deleteMany là XOÁ THẬT, không cần
// cờ hardDelete. Seed chỉ chạy ở DEV nên xoá cứng dữ liệu demo cũ là đúng ý.
const prisma = new PrismaClient();
const TAG = "[DEMO]";
const PWD = process.env.DEMO_PASSWORD || "GiaNguyenDemo2026";
const DAY = 86400000;
const ago = (d) => new Date(Date.now() - d * DAY);

async function main() {
  if (process.env.ALLOW_DEMO_SEED !== "1") {
    console.error("✗ Từ chối seed demo: cần ALLOW_DEMO_SEED=1 (chặn seed nhầm vào prod).");
    process.exit(1);
  }

  const co = await prisma.company.findUnique({ where: { code: "gia_nguyen" } });
  if (!co) { console.error("✗ Chưa có công ty gia_nguyen — chạy `npm run db:seed` trước."); process.exit(1); }
  const tplDate = await prisma.quoteTemplate.findFirst({ where: { code: "unibenfood" } });   // có ngày
  const tplNo = await prisma.quoteTemplate.findFirst({ where: { code: "marico_decor" } });    // không ngày
  const tpl = tplDate || tplNo;
  if (!tpl) { console.error("✗ Chưa có template — chạy `npm run db:seed` trước."); process.exit(1); }

  const FROM = { fromContact: "Phòng Kinh Doanh", fromPhone: co.phone || "0914291951", fromAddress: co.address || "TP.HCM", city: co.city || "TP. Hồ Chí Minh" };

  // ---------- Dọn dữ liệu demo cũ ----------
  // Thứ tự theo FK: quote (createdById/customerId/members) → customer (ownerId → user) → user.
  await prisma.quote.deleteMany({ where: { title: { startsWith: TAG } } });
  await prisma.personnelRecord.deleteMany({ where: { fullName: { startsWith: TAG } } });
  await prisma.employee.deleteMany({ where: { createdBy: { username: { startsWith: "demo_" } } } }); // trước khi xóa user (FK)
  await prisma.customer.deleteMany({ where: { code: { startsWith: "DEMOKH" } } });
  await prisma.user.deleteMany({ where: { username: { startsWith: "demo_" } } });
  console.log("✓ Đã dọn dữ liệu demo cũ");

  // ---------- Users ----------
  const hash = await bcrypt.hash(PWD, 6);
  const mkUser = (username, displayName, role, extra = {}) =>
    prisma.user.create({ data: { username, displayName, role, passwordHash: hash, active: true, ...extra } });
  const accA = await mkUser("demo_acc_a", "Account An", "manager", { projectCode: "DEMOA26" });
  const accB = await mkUser("demo_acc_b", "Account Bình", "manager", { projectCode: "DEMOB26" });
  const accSign = await mkUser("demo_acc_sign", "Account Lan (ký)", "manager", { projectCode: "DEMOL26", canSign: true });
  const hn = await mkUser("demo_hn", "HN Hằng", "account_hn");
  const hrUser = await mkUser("demo_hr", "Nhân sự Hà", "hr");
  const acctUser = await mkUser("demo_acct", "Kế toán Hồng", "accountant");
  console.log("✓ 6 user demo (mật khẩu:", PWD, ") — gồm demo_hr (Nhân sự) + demo_acct (Kế toán)");

  // ---------- DANH BẠ NHÂN VIÊN (kho cá nhân dùng chung) + HỒ SƠ NHÂN SỰ ----------
  // 7 người (đủ MST/căn cước/STK…) vào Danh bạ để CHỌN khi tạo hồ sơ. 5 người được lập hồ sơ;
  // MỖI hồ sơ trỏ DỰ ÁN ĐÃ CHỐT CỦA CHÍNH ACCOUNT đó (đúng luật "account chỉ dự án của mình")
  // → Account + cột HĐ/thanh toán (🩷) tự khớp. 2 người còn lại để demo "chọn người mới".
  const P = {
    thuong: { name: "Trần Thị Thương", taxCode: "8064192001670", birthYear: "1992", idCard: "064192001670", idDate: "2021-03-15", idPlace: "Cục CSQLHC về TTXH", address: "180/33 Nguyễn Hữu Cảnh, P.Thạnh Mỹ Tây, TPHCM", stk: "216110189", bank: "ACB", phone: "0972629827" },
    binh:   { name: "Nguyễn Văn Bình", taxCode: "8071234509", birthYear: "1990", idCard: "079090001234", idDate: "2019-06-20", idPlace: "Cục CSQLHC về TTXH", address: "45 Lê Văn Việt, TP. Thủ Đức, TPHCM", stk: "190234567", bank: "Techcombank", phone: "0905123456" },
    cuc:    { name: "Lê Thị Cúc", taxCode: "8085551122", birthYear: "1995", idCard: "079195005678", idDate: "2020-09-10", idPlace: "Cục CSQLHC về TTXH", address: "12 Phan Xích Long, Q.Phú Nhuận, TPHCM", stk: "060078945", bank: "Sacombank", phone: "0938777888" },
    dung:   { name: "Phạm Văn Dũng", taxCode: "8093334455", birthYear: "1988", idCard: "079088009012", idDate: "2018-02-05", idPlace: "Cục CSQLHC về TTXH", address: "78 Cách Mạng Tháng 8, Q.3, TPHCM", stk: "071190345", bank: "Vietcombank", phone: "0912345678" },
    em:     { name: "Võ Thị Em", taxCode: "8076667788", birthYear: "1997", idCard: "079197003456", idDate: "2022-01-12", idPlace: "Cục CSQLHC về TTXH", address: "234 Nguyễn Trãi, Q.5, TPHCM", stk: "020045678", bank: "ACB", phone: "0977888999" },
    phuc:   { name: "Hoàng Minh Phúc", taxCode: "8081119900", birthYear: "1993", idCard: "079093007788", idDate: "2021-11-03", idPlace: "Cục CSQLHC về TTXH", address: "56 Võ Văn Tần, Q.3, TPHCM", stk: "088112233", bank: "BIDV", phone: "0909001122" },
    ha:     { name: "Đặng Thị Hồng Hà", taxCode: "8082228811", birthYear: "1996", idCard: "079196004455", idDate: "2020-05-18", idPlace: "Cục CSQLHC về TTXH", address: "9 Hai Bà Trưng, Q.1, TPHCM", stk: "033445566", bank: "MB Bank", phone: "0988112233" },
  };
  const mkEmp = (creator, p) => prisma.employee.create({ data: {
    createdById: creator.id, fullName: p.name, taxCode: p.taxCode, birthYear: p.birthYear,
    idCard: p.idCard, idIssueDate: p.idDate ? new Date(p.idDate) : null, idIssuePlace: p.idPlace,
    address: p.address, bankAccount: p.stk, bankName: p.bank, phone: p.phone,
  } });
  await Promise.all([
    mkEmp(accSign, P.thuong), mkEmp(accSign, P.binh), mkEmp(accB, P.cuc),
    mkEmp(accA, P.dung), mkEmp(accA, P.em), mkEmp(accA, P.phuc), mkEmp(accB, P.ha),
  ]);
  console.log("✓ 7 nhân viên trong Danh bạ (đủ MST/căn cước/STK… để chọn khi tạo hồ sơ)");

  // ADMIN (xác nhận "đã ký") — dùng admin nền (KHÔNG phải demo_*); có thể null nếu chưa seed admin.
  const adminUser = await prisma.user.findFirst({ where: { role: "admin" }, select: { id: true } });

  // 🟡 field nhập tay. 🔵 Thuế TNCN/Thu nhập chịu thuế server tự tính. 🩷 cột HĐ tự LẤY từ Dự án.
  // THANH TOÁN: kế toán bấm (paidAt). XÁC NHẬN "đã ký": admin bấm (confirmedAt).
  const hrRec = (creator, p, o) => prisma.personnelRecord.create({ data: {
    createdById: creator.id, fullName: `${TAG} ${p.name}`,
    taxCode: p.taxCode, birthYear: p.birthYear, idCard: p.idCard,
    idIssueDate: p.idDate ? new Date(p.idDate) : null, idIssuePlace: p.idPlace,
    address: p.address, bankAccount: p.stk, bankName: p.bank, phone: p.phone,
    salary: o.salary ?? null,
    workStart: o.start ? new Date(o.start) : null, workEnd: o.end ? new Date(o.end) : null,
    workLocation: o.loc || "HCM", projectName: o.project || null, projectCode: o.code || null,
    teamNote: o.team || null, accountName: creator.displayName, company: o.cty || "GN",
    laborContractNo: o.hdld || null, laborContractDate: o.hdldDate ? new Date(o.hdldDate) : null,
    accountingNote: o.acctNote || null, note: o.note || null,
    paidAt: o.paid ? ago(o.paidAgo ?? 3) : null, paidById: o.paid ? acctUser.id : null, // KẾ TOÁN đã đánh dấu TT
    // ADMIN đã xác nhận "đã ký" (o.confirmed truthy = đã ký); confirmed string cũ KHÔNG dùng nữa.
    confirmedAt: o.confirmed && adminUser ? ago(o.confirmedAgo ?? 4) : null,
    confirmedById: o.confirmed && adminUser ? adminUser.id : null,
  } });
  // creator = CHỦ DỰ ÁN của code (DEMOL26→accSign, DEMOB26→accB, DEMOA26→accA); đủ các trạng thái HĐ.
  await hrRec(accSign, P.thuong, { salary: 10_000_000, start: "2025-10-13", end: "2025-10-24",
    project: "Lễ kỷ niệm 20 năm", code: "DEMOL26_008", team: "CP team phim (trả lại Hà)",
    hdld: "HDLD-2026-01", hdldDate: "2025-10-01", confirmed: "đã ký", paid: true, paidAgo: 2 });   // kế toán ĐÃ đánh dấu TT
  await hrRec(accSign, P.binh, { salary: 12_000_000, start: "2025-11-11", end: "2025-11-20",
    project: "Triển lãm Ô tô", code: "DEMOL26_007", confirmed: "OK" });    // có PO + số HĐ, chưa TT
  await hrRec(accB, P.cuc, { salary: 18_000_000, start: "2025-10-31", end: "2025-11-06",
    project: "Year End Party", code: "DEMOB26_005" });                      // có số HĐ, chưa TT
  await hrRec(accA, P.dung, { salary: 15_000_000, project: "Khai trương CN", code: "DEMOA26_006",
    hdld: "HDLD-2026-07", acctNote: "Đã đối chiếu", confirmed: "đã ký", paid: true, paidAgo: 5 });  // kế toán ĐÃ đánh dấu TT
  await hrRec(accA, P.em, { salary: 9_000_000, project: "Gala Vinamilk", code: "DEMOA26_004",
    note: "Chờ chứng từ" });                                                // đã chốt, chưa HĐ/PO
  console.log("✓ 5 hồ sơ nhân sự (mỗi hồ sơ trỏ dự án ĐÃ CHỐT CỦA CHÍNH account — Account + cột HĐ tự khớp)");

  // ---------- Customers ----------
  const mkCus = (code, name) => prisma.customer.create({ data: { code, name, status: "active", ownerId: accA.id } });
  const kh1 = await mkCus("DEMOKH01", "Công ty Vinamilk");
  const kh2 = await mkCus("DEMOKH02", "Sao Mai Group");
  const kh3 = await mkCus("DEMOKH03", "Bến Thành Media");
  console.log("✓ 3 khách hàng demo");

  // ---------- Helpers ----------
  let seq = 0;
  const item = (name, quantity, unitPrice, days = 1, kind = "item") => ({ kind, name, quantity, unitPrice, days });
  // Bảng nội bộ: rows = [{name, qty, price, approved}]. hcm/khach chỉ cộng hàng approved; hanoi cộng hết.
  const xtable = (category, name, rows, sIdx) => ({
    category, name,
    items: rows.map((r, j) => ({
      rid: `d${seq}_${sIdx}_${category}_${j}`, kind: "item", name: r.name,
      quantity: r.qty, unitPrice: r.price, days: 1,
      approved: !!r.approved, approvedAt: r.approved ? ago(2).toISOString() : null, approvedBy: r.approved ? 1 : null,
    })),
  });
  const sumItems = (items) => items.filter((it) => ["item", "sub"].includes(it.kind))
    .reduce((a, it) => a + Number(it.quantity) * Number(it.unitPrice) * Number(it.days || 1), 0);

  async function makeQuote(o) {
    seq++;
    const num = `GN26D${String(seq).padStart(3, "0")}`;
    const vatPercent = o.vatPercent ?? 8;
    let subtotal = 0;
    const sheetsCreate = (o.sheets || []).map((sh, i) => {
      const items = (sh.items || []).map((it, j) => {
        const b = { kind: it.kind || "item", name: it.name || `Hạng mục ${j + 1}`, quantity: it.quantity ?? 1, unitPrice: it.unitPrice ?? 0, days: it.days ?? 1, order: j };
        // DEMO công thức: item ĐẦU sheet đầu → đơn giá thành công thức =<giá>*1,1 (minh hoạ badge ƒ + xuất Excel ra công thức thật).
        if (i === 0 && j === 0 && b.kind === "item" && b.unitPrice > 0) { b.formulas = { unitPrice: `=${b.unitPrice}*1,1` }; b.unitPrice = Math.round(b.unitPrice * 1.1); }
        return b;
      });
      subtotal += sumItems(items);
      return {
        templateId: sh.templateId || tpl.id, order: i, name: sh.name || null, groupSubtotal: !!sh.groupSubtotal,
        items: { create: items },
        extraTables: sh.extraTables || undefined,
        signedAt: sh.signedAt || null, signedById: sh.signedAt ? (sh.signedById || 1) : null, signedByName: sh.signedAt ? (sh.signedByName || "Quản trị") : null,
        invoiceNo: sh.invoiceNo || null, paidAt: sh.paidAt || null,
        poNumber: sh.poNumber || null, hnInvoiceNo: sh.hnInvoiceNo || null, invoiceLink: sh.invoiceLink || null,
        docSentAt: sh.docSentAt || null, docReturnedAt: sh.docReturnedAt || null,
      };
    });
    const vat = Math.round((subtotal * vatPercent) / 100);
    const data = {
      quoteNumber: num, projectCode: `${o.creator.projectCode || "DEMO"}_${String(seq).padStart(3, "0")}`, projectVersion: 1, currentVersion: 1,
      title: `${TAG} ${o.title}`, toCompany: o.customer?.name || "Khách Demo", customerId: o.customer?.id || null,
      companyId: co.id, createdById: o.creator.id, ...FROM,
      quoteDate: ago(o.daysAgo ?? 12), executionDate: o.exec || null,
      vatPercent, subtotal, vat, total: subtotal + vat, discount: 0,
      status: o.status || "draft",
      convertedAt: o.status === "converted" ? ago(o.daysAgo ? o.daysAgo - 2 : 5) : null,
      notes: o.notes || null,
      hnStatus: o.hnStatus || null, hnAssigneeId: o.hnAssignee?.id || null,
      hnSubmittedAt: ["submitted", "approved", "rejected"].includes(o.hnStatus) ? ago(4) : null,
      hnReviewedAt: ["approved", "rejected"].includes(o.hnStatus) ? ago(3) : null,
      hnReviewerId: ["approved", "rejected"].includes(o.hnStatus) ? 1 : null,
      hnRejectNote: o.hnStatus === "rejected" ? "Cần làm rõ đơn giá vách + bổ sung kích thước." : null,
      sheets: { create: sheetsCreate },
    };
    if (o.hnAssignee) data.members = { connect: [{ id: o.hnAssignee.id }] };
    return prisma.quote.create({ data });
  }

  const std = [item("Thi công sân khấu", 1, 15_000_000), item("Màn hình LED P3", 20, 450_000), item("Âm thanh ánh sáng", 1, 8_000_000)];

  // ============ CÁC TRẠNG THÁI ============
  // 1) Nháp đơn sheet
  await makeQuote({ creator: accA, customer: kh1, title: "Sự kiện ra mắt — NHÁP", status: "draft", sheets: [{ items: std }] });
  // 2) Nháp NHIỀU sheet
  await makeQuote({ creator: accB, customer: kh2, title: "Hội nghị KH 2026 — NHÁP 2 sheet", status: "draft",
    sheets: [{ name: "Khu vực chính", items: std }, { name: "Khu trải nghiệm", items: [item("Booth", 4, 6_000_000), item("Standee", 10, 350_000)] }] });
  // 3) Không chốt (lost)
  await makeQuote({ creator: accA, customer: kh3, title: "Roadshow Q1 — KHÔNG CHỐT", status: "lost", daysAgo: 20,
    notes: "[Lý do không chốt] Khách chọn nhà cung cấp khác (giá thấp hơn 8%).", sheets: [{ items: std }] });

  // 4) Đã chốt → "Hoá đơn" (chưa có số HĐ, chưa có PO → chứng từ CHƯA đỏ)
  await makeQuote({ creator: accA, customer: kh1, title: "Gala Vinamilk — ĐÃ CHỐT (Hoá đơn)", status: "converted", exec: ago(2), sheets: [{ items: std }] });
  // 5) Đã chốt → "Thanh toán" (có số HĐ, chưa thanh toán)
  await makeQuote({ creator: accB, customer: kh2, title: "Year End Party — ĐÃ CHỐT (Thanh toán)", status: "converted", exec: ago(1),
    sheets: [{ items: std, invoiceNo: "HD-2026-0155" }] });
  // 6) Đã chốt → "Done" (có CẢ số HĐ + ngày TT)
  await makeQuote({ creator: accA, customer: kh3, title: "Khai trương CN — ĐÃ CHỐT (Done)", status: "converted", daysAgo: 30, exec: ago(15),
    sheets: [{ items: std, invoiceNo: "HD-2026-0102", paidAt: ago(5) }] });

  // 7) Đã chốt + CÓ Số PO/HĐ nhưng chứng từ CHƯA làm → ĐỎ: chứng từ gửi/về + Link HĐ + Ký
  await makeQuote({ creator: accSign, customer: kh1, title: "Triển lãm Ô tô — PO có, chứng từ ĐỎ", status: "converted", exec: ago(3),
    sheets: [{ items: std, invoiceNo: "HD-2026-0160", poNumber: "PO-VNM-7781" }] });
  // 8) Đã chốt + PO + chứng từ ĐỦ → tất cả TRẮNG (đã gửi, đã về, có link, đã ký, Done)
  await makeQuote({ creator: accSign, customer: kh2, title: "Lễ kỷ niệm 20 năm — PO + chứng từ ĐỦ", status: "converted", daysAgo: 25, exec: ago(10),
    sheets: [{ items: std, invoiceNo: "HD-2026-0099", paidAt: ago(6), poNumber: "PO-SM-3321",
      docSentAt: ago(8), docReturnedAt: ago(4), invoiceLink: "https://drive.google.com/demo-hoadon-0099",
      signedAt: ago(4), signedByName: "Account Lan (ký)" }] });

  // 9) Đã chốt + Báo giá Hà Nội ĐÃ DUYỆT nhưng CHƯA có Số HĐ HN → ô Số HĐ HN ĐỎ
  await makeQuote({ creator: accA, customer: kh3, title: "Sự kiện phía Bắc — Số HĐ HN ĐỎ", status: "converted", hnStatus: "approved", hnAssignee: hn, exec: ago(4),
    sheets: [{ items: std, invoiceNo: "HD-2026-0170",
      extraTables: [xtable("hanoi", "Giá thuê Hà Nội", [{ name: "Vách 3x6", qty: 2, price: 4_500_000 }, { name: "Sàn gỗ", qty: 1, price: 7_605_000 }], 0)] }] });
  // 10) Đã chốt + HN duyệt + ĐÃ có Số HĐ HN → TRẮNG
  await makeQuote({ creator: accB, customer: kh1, title: "Sự kiện phía Bắc 2 — Số HĐ HN đủ", status: "converted", hnStatus: "approved", hnAssignee: hn, daysAgo: 22, exec: ago(9),
    sheets: [{ items: std, invoiceNo: "HD-2026-0088", hnInvoiceNo: "HDHN-26-014",
      extraTables: [xtable("hanoi", "Giá thuê Hà Nội", [{ name: "Vách 3x6", qty: 3, price: 4_500_000 }], 0)] }] });

  // 11–13) Luồng ACCOUNT HÀ NỘI (xem ở view account_hn): assigned / submitted / rejected
  await makeQuote({ creator: accA, customer: kh2, title: "Giao HN — ĐÃ GIAO (assigned)", status: "draft", hnStatus: "assigned", hnAssignee: hn,
    sheets: [{ name: "Phần Hà Nội", items: std, extraTables: [xtable("hanoi", "Giá thuê HN", [{ name: "Khung backdrop", qty: 1, price: 5_000_000 }], 0)] }] });
  await makeQuote({ creator: accA, customer: kh3, title: "Giao HN — ĐÃ GỬI DUYỆT (submitted)", status: "draft", hnStatus: "submitted", hnAssignee: hn,
    sheets: [{ name: "Phần Hà Nội", items: std, extraTables: [xtable("hanoi", "Giá thuê HN", [{ name: "Vách", qty: 5, price: 1_200_000 }, { name: "Thảm", qty: 2, price: 900_000 }], 0)] }] });
  await makeQuote({ creator: accB, customer: kh1, title: "Giao HN — BỊ TRẢ LẠI (rejected)", status: "draft", hnStatus: "rejected", hnAssignee: hn,
    sheets: [{ name: "Phần Hà Nội", items: std, extraTables: [xtable("hanoi", "Giá thuê HN", [{ name: "LED", qty: 10, price: 600_000 }], 0)] }] });

  // 14) Đã chốt NHIỀU sheet + bảng nội bộ HCM/HN/Khách (có hàng DUYỆT, có hàng chưa) + ký 1 sheet
  await makeQuote({ creator: accA, customer: kh2, title: "Đại nhạc hội — đủ chi phí nội bộ + nhiều sheet", status: "converted", daysAgo: 18, exec: ago(7),
    sheets: [
      { name: "Sân khấu", items: std, invoiceNo: "HD-2026-0201", poNumber: "PO-SM-9000", docSentAt: ago(6), signedAt: ago(5), signedByName: "Quản trị",
        extraTables: [
          xtable("hcm", "Chi phí HCM", [{ name: "Vận chuyển", qty: 1, price: 3_000_000, approved: true }, { name: "Phát sinh", qty: 1, price: 2_000_000, approved: false }], 0),
          xtable("khach", "Phí khách hàng", [{ name: "Quản lý dự án", qty: 1, price: 5_000_000, approved: true }], 0),
        ] },
      { name: "Khu vực VIP", items: [item("Bàn ghế VIP", 30, 250_000), item("Hoa trang trí", 1, 4_000_000)],
        extraTables: [xtable("hanoi", "Giá thuê HN", [{ name: "Backdrop VIP", qty: 1, price: 6_000_000 }], 1)] },
    ] });

  const total = await prisma.quote.count({ where: { title: { startsWith: TAG } } });
  console.log(`✓ Đã tạo ${total} báo giá demo (đủ trạng thái). Đăng nhập demo_acc_a / demo_hn… mật khẩu ${PWD}.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
