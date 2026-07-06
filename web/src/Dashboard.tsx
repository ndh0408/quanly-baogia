import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, ApiError, type Me, type OverviewResp, type RevenuePoint, type TopSaleRow, type ProjectQuote, type ProjectSheet } from "./api";

// "Tổng quan" THÔNG MINH: chọn kỳ (7/30/90 ngày · quý · năm) → KPI có xu hướng so kỳ trước,
// biểu đồ doanh số theo ngày (SVG), phễu/pipeline theo kỳ kèm tỷ lệ thắng, "Cần xử lý" (AR/chứng từ
// rút từ Quản lý dự án), bảng xếp hạng (chỉ admin). Dùng design-system SPA (.kpi/.card-section/.status…).

const fmtMoney = (v: number | undefined) => Number(v || 0).toLocaleString("vi-VN");
// Rút gọn tiền cho trục biểu đồ / nơi chật: 1,2 tỷ · 350 tr · 12k.
const compactMoney = (v: number | undefined) => {
  const n = Number(v || 0);
  if (n >= 1e9) return (n / 1e9).toFixed(n >= 1e10 ? 0 : 1).replace(".", ",") + " tỷ";
  if (n >= 1e6) return Math.round(n / 1e6) + " tr";
  if (n >= 1e3) return Math.round(n / 1e3) + "k";
  return String(Math.round(n));
};
const STATUS_LABEL: Record<string, string> = { draft: "Nháp", converted: "Đã chốt", lost: "Không chốt", pending: "Chờ duyệt", approved: "Đã duyệt", sent: "Đã gửi", rejected: "Bị trả" };
const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;
const PIPE_ORDER = ["draft", "pending", "approved", "sent", "converted", "lost", "rejected"];

type PeriodKey = "7" | "30" | "90" | "quarter" | "year";
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: "7", label: "7 ngày" }, { key: "30", label: "30 ngày" }, { key: "90", label: "90 ngày" },
  { key: "quarter", label: "Quý này" }, { key: "year", label: "Năm nay" },
];
const loadPeriod = (): PeriodKey => {
  const v = (typeof localStorage !== "undefined" && localStorage.getItem("dash.period")) as PeriodKey | null;
  return PERIODS.some((p) => p.key === v) ? (v as PeriodKey) : "30";
};

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const ddmm = (s: string) => { const [, m, d] = s.split("-"); return `${d}/${m}`; };
const ddmmyyyy = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

// Kỳ hiện tại + kỳ TRƯỚC liền kề cùng độ dài (để tính ▲▼). Trả Date + ISO để gọi API.
function computeRange(key: PeriodKey) {
  const now = new Date();
  const to = now;
  let from: Date;
  if (key === "quarter") { const q = Math.floor(now.getMonth() / 3); from = new Date(now.getFullYear(), q * 3, 1); }
  else if (key === "year") { from = new Date(now.getFullYear(), 0, 1); }
  else from = new Date(now.getTime() - Number(key) * 86_400_000);
  const span = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(from.getTime() - span);
  return { from, to, prevFrom, prevTo, iso: { from: from.toISOString(), to: to.toISOString(), pf: prevFrom.toISOString(), pt: prevTo.toISOString() } };
}

// % thay đổi cur vs prev. null khi không so sánh được; isNew khi kỳ trước = 0 mà kỳ này > 0.
function delta(cur: number, prev: number): { pct: number; up: boolean; isNew?: boolean } | null {
  if (prev === 0) return cur > 0 ? { pct: 100, up: true, isNew: true } : null;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  if (Math.abs(pct) < 0.5) return { pct: 0, up: true };
  return { pct, up: pct >= 0 };
}
// Chênh lệch theo ĐIỂM phần trăm (cho Tỷ lệ chốt) — KHÔNG phải % tương đối.
function ppDelta(cur: number, prev: number): { pct: number; up: boolean } | null {
  if (cur === 0 && prev === 0) return null;
  return { pct: cur - prev, up: cur >= prev };
}

function TrendChip({ d, goodWhenUp = true, suffix }: { d: { pct: number; up: boolean; isNew?: boolean } | null; goodWhenUp?: boolean; suffix?: string }) {
  if (!d) return <span className="trend trend-flat" title="Không có dữ liệu kỳ trước để so sánh">—</span>;
  if (d.isNew) return <span className="trend trend-up" title="Kỳ trước không có">▲ mới</span>;
  if (d.pct === 0) return <span className="trend trend-flat">↔ 0%</span>;
  const good = d.up === goodWhenUp;
  return (
    <span className={`trend ${good ? "trend-up" : "trend-down"}`} title="So với kỳ trước liền kề">
      {d.up ? "▲" : "▼"} {Math.abs(d.pct).toFixed(Math.abs(d.pct) >= 10 ? 0 : 1)}{suffix ?? "%"}
    </span>
  );
}

// ===== Biểu đồ doanh số theo ngày (SVG thuần — KHÔNG thư viện) =====
type ChartPoint = { key: string; label: string; amount: number; n: number };
function RevenueChart({ points }: { points: ChartPoint[] }) {
  const [hi, setHi] = useState<number | null>(null);
  const total = points.reduce((s, p) => s + p.amount, 0);
  const deals = points.reduce((s, p) => s + p.n, 0);
  const max = Math.max(1, ...points.map((p) => p.amount));
  const W = 820, H = 260, padL = 58, padR = 14, padT = 16, padB = 28;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const n = points.length;
  const x = (i: number) => padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const step = n > 1 ? innerW / (n - 1) : innerW;
  const baseY = padT + innerH;

  if (total <= 0) {
    return <div className="empty" style={{ padding: 36 }}>Chưa có doanh số đã chốt trong kỳ này.</div>;
  }

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.amount).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)},${baseY.toFixed(1)} L${x(0).toFixed(1)},${baseY.toFixed(1)} Z`;
  const gridVals = [0, max / 2, max];
  // Nhãn trục X: ~6 mốc đều nhau.
  const tickIdx = n <= 1 ? [0] : Array.from(new Set([0, ...[1, 2, 3, 4].map((k) => Math.round((k / 5) * (n - 1))), n - 1]));
  const hp = hi != null ? points[hi] : null;
  const leftPct = hi != null ? Math.min(92, Math.max(8, (x(hi) / W) * 100)) : 0;

  return (
    <div className="chart-wrap" onMouseLeave={() => setHi(null)}>
      <div className="chart-caption muted">Tổng kỳ: <strong>{fmtMoney(total)} đ</strong> · {deals} hợp đồng chốt</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="rev-chart" role="img" aria-label={`Biểu đồ doanh số theo ngày, tổng ${fmtMoney(total)} đồng`}>
        <defs>
          <linearGradient id="revfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.30" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {gridVals.map((g, i) => (
          <g key={i}>
            <line x1={padL} y1={y(g)} x2={W - padR} y2={y(g)} className="grid-line" />
            <text x={padL - 8} y={y(g) + 4} className="axis-label" textAnchor="end">{compactMoney(g)}</text>
          </g>
        ))}
        <path d={area} fill="url(#revfill)" />
        <path d={line} className="rev-line" fill="none" />
        {tickIdx.map((i) => (
          <text key={i} x={x(i)} y={H - 8} className="axis-label" textAnchor="middle">{points[i].label}</text>
        ))}
        {hp && (
          <g>
            <line x1={x(hi!)} y1={padT} x2={x(hi!)} y2={baseY} className="hover-line" />
            <circle cx={x(hi!)} cy={y(hp.amount)} r={4.5} className="hover-dot" />
          </g>
        )}
        {/* vùng bắt hover theo từng ngày */}
        {points.map((_p, i) => (
          <rect key={i} x={x(i) - step / 2} y={padT} width={step} height={innerH} fill="transparent"
                onMouseEnter={() => setHi(i)} />
        ))}
      </svg>
      {hp && (
        <div className="chart-tip" style={{ left: `${leftPct}%` }}>
          <strong>{fmtMoney(hp.amount)} đ</strong>
          <span>{hp.key.split("-").reverse().join("/")} · {hp.n} hợp đồng</span>
        </div>
      )}
    </div>
  );
}

// ===== Phễu / pipeline theo kỳ (từ overview.counts + overview.sums) =====
function Pipeline({ ov }: { ov: OverviewResp }) {
  const rows = PIPE_ORDER.filter((s) => (ov.counts[s] || 0) > 0).map((s) => ({ s, count: ov.counts[s] || 0, sum: ov.sums[s] || 0 }));
  const maxCount = Math.max(1, ...rows.map((r) => r.count));
  const won = ov.counts.converted || 0;
  const lost = ov.counts.lost || 0;
  const decided = won + lost;
  const winRate = decided > 0 ? Math.round((won / decided) * 100) : null;
  const goList = (status: string) => { location.hash = `#/list?status=${status}`; };

  if (rows.length === 0) return <div className="empty">Chưa có báo giá nào trong kỳ.</div>;
  return (
    <div className="pipeline">
      {winRate != null && (
        <div className="winrate">
          <span className="winrate-pct">{winRate}%</span>
          <span className="muted">tỷ lệ thắng · {won} chốt / {decided} đã quyết định</span>
        </div>
      )}
      {rows.map((r) => (
        <div key={r.s} className="pipe-row" role="button" tabIndex={0}
             aria-label={`Lọc danh sách: ${statusLabel(r.s)} (${r.count})`}
             onClick={() => goList(r.s)}
             onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goList(r.s); } }}>
          <div className="pipe-head"><span className={`status ${r.s}`}>{statusLabel(r.s)}</span><strong>{r.count}</strong></div>
          <div className="funnel-track"><div className="funnel-bar" style={{ width: Math.max(5, Math.round((r.count / maxCount) * 100)) + "%" }} /></div>
          <div className="pipe-val">{fmtMoney(r.sum)} đ</div>
        </div>
      ))}
    </div>
  );
}

// ===== Bảng xếp hạng nhân viên (chỉ admin) =====
function Leaderboard({ rows }: { rows: TopSaleRow[] }) {
  const data = rows.filter((r) => r.amount > 0 || r.count > 0);
  const max = Math.max(1, ...data.map((r) => r.amount));
  const medal = ["🥇", "🥈", "🥉"];
  if (data.length === 0) return <div className="empty">Chưa có doanh số đã chốt.</div>;
  return (
    <div className="lead-list">
      {data.map((r, i) => (
        <div key={r.userId} className="lead-row">
          <span className="lead-rank">{medal[i] || i + 1}</span>
          <div className="lead-main">
            <div className="lead-top"><span className="lead-name">{r.user?.displayName || "—"}</span><span className="lead-amt">{fmtMoney(r.amount)} đ</span></div>
            <div className="funnel-track"><div className="funnel-bar" style={{ width: Math.max(4, Math.round((r.amount / max) * 100)) + "%" }} /></div>
          </div>
          <span className="lead-cnt">{r.count} BG</span>
        </div>
      ))}
    </div>
  );
}

// ===== "Cần xử lý" — rút từ Quản lý dự án (mỗi sheet 1 việc). KHÔNG theo kỳ (việc tồn đọng). =====
type ActItem = { quoteId: number; code: string; hangMuc: string | null; customer: string; amount: number };
type ActCat = { key: string; title: string; cls: string; items: ActItem[]; total: number; showAmount: boolean };

function buildActionItems(projects: ProjectQuote[]): ActCat[] {
  const A: ActItem[] = [], B: ActItem[] = [], C: ActItem[] = [], D: ActItem[] = [];
  for (const p of projects) {
    const sheets: ProjectSheet[] = p.sheets && p.sheets.length ? p.sheets : [{ subtotal: p.subtotal, name: null }];
    const multi = sheets.length > 1;
    const base = (p.projectCode || p.quoteNumber || "—") + (p.projectVersion && p.projectVersion > 1 ? `_v${p.projectVersion}` : "");
    const customer = p.customerName || p.customerCode || p.title || "—";
    sheets.forEach((sh, i) => {
      const baoGia = Number(sh.subtotal || 0);
      const vatAmt = Math.round(baoGia * Number(p.vatPercent || 0) / 100);
      const amount = baoGia + vatAmt;
      const it: ActItem = { quoteId: p.id, code: base + (multi ? `_${i + 1}` : ""), hangMuc: sh.name ?? null, customer, amount };
      if (sh.invoiceNo && !sh.paidAt) B.push(it);                                   // đã xuất HĐ chờ thu tiền (AR)
      if (sh.signedAt && !sh.invoiceNo) A.push(it);                                 // đã ký, chưa xuất hóa đơn
      if (sh.poNumber && (!sh.docSentAt || !sh.docReturnedAt)) C.push(it);          // có PO, chứng từ chưa hoàn tất
      if (p.hnStatus === "approved" && Number(sh.hanoi || 0) > 0 && !sh.hnInvoiceNo) D.push(it); // HN duyệt, thiếu số HĐ HN
    });
  }
  const mk = (key: string, title: string, cls: string, items: ActItem[], showAmount: boolean): ActCat =>
    ({ key, title, cls, items, total: items.reduce((s, x) => s + x.amount, 0), showAmount });
  return [
    mk("ar", "Đã xuất HĐ · chờ thu tiền", "sent", B, true),
    mk("inv", "Đã ký · chưa xuất hóa đơn", "pending", A, true),
    mk("doc", "Có PO · chứng từ chưa hoàn tất", "pending", C, false),
    mk("hn", "HN đã duyệt · thiếu số HĐ HN", "rejected", D, false),
  ].filter((c) => c.items.length > 0);
}

function ActionItems({ projects }: { projects: ProjectQuote[] }) {
  const cats = useMemo(() => buildActionItems(projects), [projects]);
  if (cats.length === 0) return <div className="empty">Tuyệt vời — không có việc tồn đọng nào cần xử lý. 🎉</div>;
  const open = (id: number) => { location.hash = `#/quotes/${id}`; };
  return (
    <div className="act-grid">
      {cats.map((c) => (
        <div key={c.key} className={`act-card act-${c.cls}`}>
          <div className="act-head">
            <span className={`status ${c.cls}`}>{c.title}</span>
            <span className="act-count">{c.items.length}</span>
          </div>
          {c.showAmount && <div className="act-total">{fmtMoney(c.total)} đ</div>}
          <div className="act-items">
            {c.items.slice(0, 5).map((it, idx) => (
              <button key={idx} className="act-item" onClick={() => open(it.quoteId)} title="Mở báo giá">
                <span className="act-code">{it.code}</span>
                <span className="act-cust">{it.hangMuc ? `${it.hangMuc} · ` : ""}{it.customer}</span>
                {c.showAmount && <span className="act-amt">{compactMoney(it.amount)}</span>}
              </button>
            ))}
          </div>
          {c.items.length > 5 && (
            <button className="act-more" onClick={() => { location.hash = "#/projects"; }}>+ {c.items.length - 5} nữa · xem tất cả →</button>
          )}
        </div>
      ))}
    </div>
  );
}

export function DashboardPage({ me }: { me: Me }) {
  const isAdmin = me.permissions.includes("quote:read:all");
  const [period, setPeriod] = useState<PeriodKey>(loadPeriod());
  const range = useMemo(() => computeRange(period), [period]);

  const { data, isPending, error, refetch, isFetching } = useQuery({
    queryKey: ["dashboard", period],
    queryFn: async () => {
      const [cur, prev, rev, top] = await Promise.all([
        api.analyticsOverview(range.iso.from, range.iso.to),
        api.analyticsOverview(range.iso.pf, range.iso.pt),
        api.analyticsRevenueByDay(range.iso.from, range.iso.to),
        isAdmin ? api.analyticsTopSales(8, range.iso.from, range.iso.to) : Promise.resolve({ data: [] as TopSaleRow[] }),
      ]);
      return { cur, prev, rev: rev.data, top: top.data };
    },
  });

  // "Cần xử lý" dùng query riêng (KHÔNG theo kỳ) — dùng chung cache với trang Quản lý dự án.
  const proj = useQuery({ queryKey: ["quoteProjects"], queryFn: () => api.quoteProjects(), staleTime: 60_000 });

  // Đổ đầy các ngày 0-doanh-số để biểu đồ liền mạch theo kỳ đã chọn.
  const chartPoints: ChartPoint[] = useMemo(() => {
    const map = new Map((data?.rev ?? []).map((r: RevenuePoint) => [String(r.d).slice(0, 10), r]));
    const days: ChartPoint[] = [];
    const d = startOfDay(range.from), end = startOfDay(range.to);
    let guard = 0;
    while (d <= end && guard++ < 800) {
      const k = ymd(d); const hit = map.get(k);
      days.push({ key: k, label: ddmm(k), amount: Number(hit?.amount || 0), n: Number(hit?.n || 0) });
      d.setDate(d.getDate() + 1);
    }
    return days;
  }, [data?.rev, range.from, range.to]);

  const onPeriod = (p: PeriodKey) => { setPeriod(p); try { localStorage.setItem("dash.period", p); } catch { /* ignore */ } };
  const err = error ? (error instanceof ApiError ? error.message : "Lỗi tải dữ liệu") : "";

  const k = data?.cur.kpi, pk = data?.prev.kpi;

  return (
    <div className="dash">
      <div className="dash-header">
        <div>
          <h1>Tổng quan</h1>
          <p className="muted dash-sub">{ddmmyyyy(range.from)} – {ddmmyyyy(range.to)} · so với kỳ trước liền kề</p>
        </div>
        <div className="dash-controls">
          <div className="seg" role="tablist" aria-label="Chọn kỳ">
            {PERIODS.map((p) => (
              <button key={p.key} role="tab" aria-selected={period === p.key}
                      className={`seg-btn ${period === p.key ? "active" : ""}`} onClick={() => onPeriod(p.key)}>{p.label}</button>
            ))}
          </div>
          <button className="btn btn-sm" onClick={() => refetch()} disabled={isFetching} title="Tải lại">{isFetching ? "Đang tải…" : "↻ Làm mới"}</button>
        </div>
      </div>

      {err && <div className="err">⚠ {err} <button className="btn btn-sm" onClick={() => refetch()}>Thử lại</button></div>}

      {isPending ? (
        <div className="skeleton-wrap" style={{ marginTop: 14 }}>{Array.from({ length: 6 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
      ) : data && k && pk ? (
        <>
          {/* Kỳ TRƯỚC rỗng (chưa có báo giá nào) → KHÔNG có gì để so → hiện "—" thay vì "▲ mới" tràn lan
              (mọi KPI nhảy từ 0). Nếu kỳ trước CÓ dữ liệu mà 1 chỉ số =0 thì "▲ mới" vẫn giữ (có ý nghĩa). */}
          {(() => { const prevEmpty = (pk.totalQuotes ?? 0) === 0; const cmp = (d: ReturnType<typeof delta>) => prevEmpty ? null : d; return (
          <div className="kpi-grid dash-kpi">
            <div className="kpi"><span>Báo giá tạo</span><strong>{k.totalQuotes}</strong><TrendChip d={cmp(delta(k.totalQuotes, pk.totalQuotes))} /></div>
            <div className="kpi"><span>Doanh số đã chốt</span><strong>{fmtMoney(k.approvedAmount)} đ</strong><TrendChip d={cmp(delta(k.approvedAmount, pk.approvedAmount))} /></div>
            <div className="kpi"><span>Tỷ lệ chốt</span><strong>{k.conversionRate}%</strong><TrendChip d={prevEmpty ? null : ppDelta(k.conversionRate, pk.conversionRate)} suffix=" điểm" /></div>
            <div className="kpi"><span>Deal trung bình</span><strong>{fmtMoney(Math.round(k.avgDealSize))} đ</strong><TrendChip d={cmp(delta(k.avgDealSize, pk.avgDealSize))} /></div>
            <div className="kpi"><span>Đang chào · {data.cur.counts.draft || 0} BG</span><strong>{fmtMoney(data.cur.sums.draft)} đ</strong><TrendChip d={cmp(delta(data.cur.sums.draft || 0, data.prev.sums.draft || 0))} /></div>
          </div>
          ); })()}

          <section className="card-section dash-chart">
            <h3>Doanh số đã chốt theo ngày</h3>
            <RevenueChart points={chartPoints} />
          </section>

          {isAdmin ? (
            <div className="dash-cols">
              <section className="card-section"><h3>Pipeline báo giá <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>(bấm để lọc)</span></h3><Pipeline ov={data.cur} /></section>
              <section className="card-section"><h3>Top nhân viên · doanh số chốt</h3><Leaderboard rows={data.top} /></section>
            </div>
          ) : (
            <section className="card-section"><h3>Pipeline báo giá <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>(bấm để lọc)</span></h3><Pipeline ov={data.cur} /></section>
          )}

          <section className="card-section">
            <h3>Cần xử lý <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· hợp đồng đang theo dõi (không theo kỳ)</span></h3>
            {proj.isPending ? <div className="skeleton-wrap">{Array.from({ length: 2 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
              : proj.error ? <div className="err">Không tải được danh sách dự án. <button className="btn btn-sm" onClick={() => proj.refetch()}>Thử lại</button></div>
              : <ActionItems projects={proj.data?.data ?? []} />}
          </section>
        </>
      ) : null}
    </div>
  );
}
