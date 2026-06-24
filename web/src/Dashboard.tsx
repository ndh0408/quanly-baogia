import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "./api";

// Port "Tổng quan" (renderDashboard) — bê ĐẦY ĐỦ: 4 KPI (30 ngày) + Phễu báo giá (bấm → lọc
// Danh sách theo trạng thái) + Top nhân viên (doanh số đã chốt) + skeleton/empty/error.
// Dùng class .kpi-grid/.kpi/.dash-cols/.funnel/.list-table SPA.
const fmtMoney = (v: number) => Number(v || 0).toLocaleString("vi-VN");
const STATUS_LABEL: Record<string, string> = { draft: "Nháp", converted: "Đã chốt", lost: "Không chốt", pending: "Chờ duyệt", approved: "Đã duyệt", sent: "Đã gửi", rejected: "Bị trả" };
const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;

type Kpi = { totalQuotes: number; approvedAmount: number; avgDealSize: number; conversionRate: number };
type FunnelRow = { status: string; count: number };
type TopRow = { user?: { displayName?: string } | null; count: number; amount: number };

export function DashboardPage() {
  const [kpi, setKpi] = useState<Kpi | null>(null);
  const [funnel, setFunnel] = useState<FunnelRow[]>([]);
  const [top, setTop] = useState<TopRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const [o, f, t] = await Promise.all([api.analyticsOverview(), api.analyticsFunnel(), api.analyticsTopSales()]);
      setKpi(o.kpi); setFunnel(f.data); setTop(t.data);
    } catch (ex) { setErr(ex instanceof ApiError ? ex.message : "Lỗi tải dữ liệu"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Bấm 1 mức phễu → mở Danh sách báo giá đã LỌC theo trạng thái (SPA list hydrate từ URL query).
  const openFiltered = (status: string) => { location.hash = `#/list?status=${status}`; };

  const maxCount = Math.max(1, ...funnel.map((s) => s.count));

  return (
    <div>
      <h1>Tổng quan</h1>
      <p className="muted" style={{ margin: "-8px 0 16px" }}>Số liệu 30 ngày gần nhất</p>

      {err && <div className="err">⚠ {err} <button className="btn btn-sm" onClick={load}>Thử lại</button></div>}

      {loading ? (
        <div className="skeleton-wrap">{Array.from({ length: 4 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
      ) : (
        <>
          <div className="kpi-grid">
            <div className="kpi"><span>Báo giá (30 ngày)</span><strong>{kpi?.totalQuotes ?? 0}</strong></div>
            <div className="kpi"><span>Doanh số đã chốt</span><strong>{fmtMoney(kpi?.approvedAmount ?? 0)} đ</strong></div>
            <div className="kpi"><span>Trung bình / báo giá</span><strong>{fmtMoney(Math.round(kpi?.avgDealSize ?? 0))} đ</strong></div>
            <div className="kpi"><span>Tỷ lệ chốt</span><strong>{kpi?.conversionRate ?? 0}%</strong></div>
          </div>

          <div className="dash-cols">
            <section>
              <h3>Phễu báo giá</h3>
              <div className="funnel">
                {funnel.length === 0 ? <div className="empty">Không có dữ liệu</div> : funnel.map((s) => (
                  <div key={s.status} className="funnel-row" role="button" tabIndex={0}
                       aria-label={`Lọc danh sách: ${statusLabel(s.status)} (${s.count})`}
                       onClick={() => openFiltered(s.status)}
                       onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openFiltered(s.status); } }}>
                    <span className={`status ${s.status}`}>{statusLabel(s.status)}</span>
                    <div className="funnel-track"><div className="funnel-bar" style={{ width: s.count ? Math.max(5, Math.round(s.count / maxCount * 100)) + "%" : "0" }} /></div>
                    <strong>{s.count}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3>Top nhân viên (doanh số đã chốt)</h3>
              {top.length === 0 ? <div className="empty">Chưa có doanh số đã chốt</div> : (
                <div className="list-wrap">
                  <table className="list-table">
                    <thead><tr><th>#</th><th>Nhân viên</th><th style={{ textAlign: "right" }}>Số BG</th><th style={{ textAlign: "right" }}>Doanh số (đ)</th></tr></thead>
                    <tbody>
                      {top.map((t, i) => (
                        <tr key={i}>
                          <td>{i + 1}</td>
                          <td>{t.user?.displayName || "—"}</td>
                          <td style={{ textAlign: "right" }}>{t.count}</td>
                          <td style={{ textAlign: "right" }}>{fmtMoney(t.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
