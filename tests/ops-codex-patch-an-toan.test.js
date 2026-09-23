/**
 * OPS · GAP1-07 / DEP-05 — script vá codex-security không chạy được VÔ TÌNH, và không bao giờ để
 * node_modules nửa vá.
 *
 * LỖI (c450a46): chú thích ghi "chạy tự động qua postinstall" (sai — hook đã gỡ); chạy tay là vá ngay
 * agent quét sang `danger-full-access` + `approvalPolicy: never` trên máy có quyền production; và mọi
 * `throw` giữa chừng bị nuốt thành exit 0 sau khi đã ghi một phần tệp.
 * KHÔNG gỡ gói (chủ repo có thể đang dùng) — chỉ chặn đường vô tình.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const GOC = path.resolve(import.meta.dirname, "..");
const TEP = path.join(GOC, "scripts/patch-codex-security-9router.mjs");
const src = readFileSync(TEP, "utf8");

describe("patch-codex-security-9router.mjs", () => {
  it("không có xác nhận tường minh → thoát 1, không vá gì", () => {
    const env = { ...process.env };
    delete env.QUANLY_VA_CODEX_KHONG_SANDBOX;
    const r = spawnSync(process.execPath, [TEP], { cwd: GOC, env, encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/Từ chối/);
  });

  it("chú thích không còn nói là hook postinstall", () => {
    expect(src.split("\n").slice(0, 3).join("\n")).not.toMatch(/Chạy tự động qua `postinstall`/);
  });

  it("mọi lần ghi thật chỉ nằm ở MỘT vòng cuối (không để node_modules nửa vá)", () => {
    const ghi = [...src.matchAll(/await ghiThat\(/g)];
    expect(ghi.length).toBe(1);
    expect(src.indexOf("await ghiThat(")).toBeGreaterThan(src.lastIndexOf('throw new Error("Could not'));
  });
});
