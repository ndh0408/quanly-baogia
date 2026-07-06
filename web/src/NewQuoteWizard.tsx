import { useEffect, useState } from "react";
import { api, ApiError, type Me, type EditorCompany, type EditorTemplate, type AssignableUser, type Customer, type QuoteFull } from "./api";
import { toast } from "./ui";
import { setPendingNewQuote } from "./pendingQuote";

// Port "Tạo báo giá mới" (renderNewQuote) — 3 bước: chọn công ty → chọn mẫu (nhiều = nhiều sheet) →
// thông tin (tiêu đề/khách/người-gửi/VAT/ngày/logo). KHÔNG tạo ngay: dựng draft _new + mở editor #/rnew
// (editor bấm Lưu mới POST — như SPA). Khách hàng chọn qua modal; người gửi chọn nhanh tự điền.

const STEPS = ["Công ty phát hành", "Mẫu báo giá", "Thông tin"];
const ROLE_LABEL: Record<string, string> = { admin: "Quản trị", manager: "Account", account_hn: "Account HN", hr: "Nhân sự", accountant: "Kế toán" };
const DEFAULT_GREETING = "Chân thành cảm ơn Quí khách hàng đã quan tâm đến dịch vụ của chúng tôi, chúng tôi xin gởi bảng báo giá theo yêu cầu như sau:";
const safeLogo = (s: string) => /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(s) ? s : "";

export function NewQuoteWizard({ me }: { me: Me }) {
  const [companies, setCompanies] = useState<EditorCompany[]>([]);
  const [templates, setTemplates] = useState<EditorTemplate[]>([]);
  const [managers, setManagers] = useState<AssignableUser[]>([]);
  const [step, setStep] = useState(1);
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [templateIds, setTemplateIds] = useState<number[]>([]);
  const [managerId, setManagerId] = useState<number | null>(me.id);   // người phụ trách (mặc định = người tạo; đổi theo người gửi)
  const [customer, setCustomer] = useState<{ id: number; code: string; name: string } | null>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [info, setInfo] = useState({
    title: "", toCompany: "", toContact: "",
    fromContact: me.senderName || me.displayName || "", fromPhone: me.phone || "", fromTitle: me.title || "",
    fromAddress: "", vatPercent: 8, quoteDate: new Date().toISOString().slice(0, 10), customerLogo: "" as string,
  });

  useEffect(() => {
    Promise.all([api.metaCompanies(), api.metaTemplates(), api.assignableUsers()]).then(([cs, ts, us]) => {
      setCompanies(cs); setTemplates(ts);
      setManagers((us.data || []).filter((u) => u.role === "manager" || u.role === "admin"));
      if (cs[0]) { setCompanyId(cs[0].id); setInfo((f) => ({ ...f, fromAddress: cs[0].address || "" })); }
    }).catch((ex) => toast(ex instanceof ApiError ? ex.message : "Lỗi tải dữ liệu", "error"));
  }, []);

  const set = (k: string, v: unknown) => setInfo((f) => ({ ...f, [k]: v }));
  const pickCompany = (id: number) => { setCompanyId(id); setTemplateIds([]); const co = companies.find((c) => c.id === id); set("fromAddress", co?.address || ""); };
  const toggleTpl = (id: number) => setTemplateIds((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const onSender = (v: string) => {
    setManagerId(v === "__me" ? me.id : Number(v) || null);   // người gửi = người phụ trách
    const p = v === "__me" ? { senderName: me.senderName, displayName: me.displayName, title: me.title, phone: me.phone } : managers.find((m) => String(m.id) === v);
    if (!p) return;
    setInfo((f) => ({ ...f, fromContact: ((p as AssignableUser).senderName || (p as { displayName?: string }).displayName) || "", fromTitle: p.title || "", fromPhone: (p as { phone?: string }).phone || "" }));
  };
  const onLogo = (file?: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast("Logo phải nhỏ hơn 2MB", "error"); return; }
    const reader = new FileReader();
    reader.onload = () => set("customerLogo", String(reader.result || ""));
    reader.readAsDataURL(file);
  };

  const next = () => {
    if (step === 1) { if (!companyId) return toast("Chọn công ty", "error"); setStep(2); return; }
    if (step === 2) { if (!templateIds.length) return toast("Chọn ít nhất 1 mẫu", "error"); setStep(3); return; }
    if (!info.title.trim()) return toast("Nhập tiêu đề báo giá", "error");
    if (!customer) return toast("Chọn mã khách hàng (bấm 'Chọn khách hàng')", "error");
    if (!info.toCompany.trim()) return toast("Nhập tên khách hàng", "error");
    const sheets = templateIds.map((tid) => { const t = templates.find((x) => x.id === tid); return { templateId: tid, name: t?.name || "Sheet", groupSubtotal: true, items: [{ kind: "item", name: "", detail: "", unit: "", quantity: 1, unitPrice: 0, days: null, notes: "" }] }; });
    const draft: QuoteFull = {
      id: 0, _new: true, status: "draft", title: info.title, toCompany: info.toCompany, toContact: info.toContact,
      fromContact: info.fromContact, fromPhone: info.fromPhone, fromTitle: info.fromTitle, fromAddress: info.fromAddress,
      vatPercent: Number(info.vatPercent) || 0, quoteDate: info.quoteDate, city: "TP. Hồ Chí Minh", discount: 0, showTotals: true,
      greeting: DEFAULT_GREETING, quoteNumber: "", companyId: companyId!, managerId, customerId: customer.id, customerCode: customer.code,
      customerLogo: info.customerLogo || null, sheets,
    } as QuoteFull;
    setPendingNewQuote(draft);
    location.hash = "#/rnew";
  };

  const coTemplates = templates.filter((t) => t.companyId === companyId);

  return (
    <div className="wizard">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <h1>Tạo báo giá mới</h1>
        <button className="btn" onClick={() => { location.hash = "#/list"; }}>← Hủy</button>
      </div>
      <div className="stepper" style={{ display: "flex", gap: 8, margin: "10px 0 16px", flexWrap: "wrap" }}>
        {STEPS.map((s, i) => { const n = i + 1; const state = n === step ? "active" : n < step ? "done" : ""; return (
          <button key={s} className={`step-dot ${state}`} disabled={n > step} onClick={() => n < step && setStep(n)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 999, border: "1px solid var(--border-strong)", background: n === step ? "var(--accent, #1a73e8)" : n < step ? "var(--surface)" : "transparent", color: n === step ? "#fff" : "inherit", cursor: n < step ? "pointer" : "default", fontWeight: 600, fontSize: 13 }}>
            <span style={{ display: "inline-flex", width: 20, height: 20, borderRadius: 999, background: n <= step ? "rgba(0,0,0,.15)" : "var(--soft)", alignItems: "center", justifyContent: "center", fontSize: 12 }}>{n < step ? "✓" : n}</span>{s}
          </button>); })}
      </div>

      <div className="wizard-card">
        {step === 1 && (
          <>
            <h2>Chọn công ty phát hành</h2>
            <p className="hint">Báo giá sẽ dùng letterhead / mẫu của công ty này.</p>
            <div className="pick-grid">
              {companies.map((c) => (
                <div key={c.id} className={`pick-card ${c.id === companyId ? "selected" : ""}`} role="button" tabIndex={0} aria-pressed={c.id === companyId} onClick={() => pickCompany(c.id)}>
                  <div className="pc-title">{c.shortName || c.name}</div>
                  <div className="pc-sub">{c.name}</div>
                  <div className="pc-sub">{templates.filter((t) => t.companyId === c.id).length} mẫu</div>
                  <div className="pc-check">✓</div>
                </div>
              ))}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h2>Chọn mẫu báo giá (mỗi mẫu = 1 sheet)</h2>
            <p className="hint">Chọn 1 hoặc nhiều mẫu. Có thể đổi thứ tự / thêm sheet sau.</p>
            <div className="pick-grid">
              {coTemplates.map((t) => (
                <div key={t.id} className={`pick-card ${templateIds.includes(t.id) ? "selected" : ""}`} role="button" tabIndex={0} aria-pressed={templateIds.includes(t.id)} onClick={() => toggleTpl(t.id)}>
                  <div className="pc-title">{t.name}</div>
                  <div className="pc-sub">{t.code}</div>
                  <div className="pc-check">✓</div>
                </div>
              ))}
            </div>
            {templateIds.length > 0 && (
              <div className="sheet-chips">
                {templateIds.map((id, i) => { const t = coTemplates.find((x) => x.id === id); return (
                  <span key={id} className="sheet-chip">{i + 1}. {t?.name} <span className="x" role="button" aria-label="Bỏ mẫu" onClick={() => toggleTpl(id)}>✕</span></span>); })}
              </div>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <h2>Thông tin báo giá</h2>
            <p className="hint">Khách hàng, người gửi, VAT, ngày — và logo khách (chèn vào mẫu CLF).</p>
            <div className="form-grid">
              <label style={{ gridColumn: "1/-1" }}>Tiêu đề báo giá <span className="req">*</span><input value={info.title} placeholder="VD: Décor Premiere Phim Thỏ Ơi" onChange={(e) => set("title", e.target.value)} /></label>
              <label style={{ gridColumn: "1/-1" }}>Mã khách hàng <span className="req">*</span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input value={customer ? `${customer.code} — ${customer.name}` : ""} placeholder="Chưa chọn — bấm nút bên phải" readOnly style={{ flex: 1 }} />
                  <button type="button" className="btn btn-sm btn-primary" onClick={() => setPickOpen(true)}>Chọn khách hàng</button>
                </div></label>
              <label>Khách hàng (To) <span className="req">*</span><input value={info.toCompany} onChange={(e) => set("toCompany", e.target.value)} /></label>
              <label>Người liên hệ KH<input value={info.toContact} onChange={(e) => set("toContact", e.target.value)} /></label>
              <label style={{ gridColumn: "1/-1" }}>Người gửi — chọn nhanh
                <select defaultValue="__me" onChange={(e) => onSender(e.target.value)}>
                  <option value="__me">Bạn — {me.senderName || me.displayName}{me.title ? " · " + me.title : ""}</option>
                  {managers.filter((m) => m.id !== me.id).map((m) => <option key={m.id} value={m.id}>{m.senderName || m.displayName} ({ROLE_LABEL[m.role || ""] || m.role}{m.title ? " · " + m.title : ""})</option>)}
                </select>
                <span className="muted" style={{ fontSize: 12 }}>Tự điền Tên + Chức danh + SĐT người gửi — vẫn sửa tay được bên dưới.</span></label>
              <label>Người gửi (From)<input value={info.fromContact} onChange={(e) => set("fromContact", e.target.value)} /></label>
              <label>Chức danh<input value={info.fromTitle} placeholder="VD: Account, Sale…" onChange={(e) => set("fromTitle", e.target.value)} /></label>
              <label>SĐT người gửi<input value={info.fromPhone} onChange={(e) => set("fromPhone", e.target.value)} /></label>
              <label>Địa chỉ (tự theo công ty)<input value={info.fromAddress} readOnly title="Tự lấy theo Công ty bên gửi" /></label>
              <label>VAT (%)<input type="number" step="0.1" value={info.vatPercent} onChange={(e) => set("vatPercent", e.target.value)} /></label>
              <label>Ngày<input type="date" value={info.quoteDate} onChange={(e) => set("quoteDate", e.target.value)} /></label>
              <div style={{ gridColumn: "1/-1" }}>
                <div style={{ fontSize: 13, color: "var(--text-soft)", fontWeight: 500, marginBottom: 5 }}>Logo khách hàng (tùy chọn)</div>
                {info.customerLogo ? (
                  <div className="logo-drop has"><img src={safeLogo(info.customerLogo)} alt="Logo khách hàng" style={{ maxHeight: 60 }} /><div className="logo-actions"><label className="btn btn-sm">Đổi<input type="file" accept="image/png,image/jpeg" style={{ display: "none" }} onChange={(e) => onLogo(e.target.files?.[0])} /></label><button className="btn btn-sm btn-danger" onClick={() => set("customerLogo", "")}>Xóa</button></div></div>
                ) : (
                  <label className="logo-drop" style={{ cursor: "pointer", display: "block" }}>📁 Bấm để chọn ảnh logo (PNG/JPG, &lt; 2MB)<input type="file" accept="image/png,image/jpeg" style={{ display: "none" }} onChange={(e) => onLogo(e.target.files?.[0])} /></label>
                )}
              </div>
            </div>
          </>
        )}

        <div className="wizard-foot" style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
          <button className="btn" disabled={step === 1} onClick={() => step > 1 && setStep(step - 1)}>← Quay lại</button>
          <button className="btn btn-primary" onClick={next}>{step === 3 ? "Nhập hạng mục →" : "Tiếp tục →"}</button>
        </div>
      </div>

      {pickOpen && <CustomerPicker onClose={() => setPickOpen(false)} onPick={(c) => { setCustomer({ id: c.id, code: c.code, name: c.name || "" }); setPickOpen(false); }} />}
    </div>
  );
}

function CustomerPicker({ onClose, onPick }: { onClose: () => void; onPick: (c: Customer) => void }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Customer[] | null>(null);
  useEffect(() => { const t = setTimeout(() => { api.listCustomers(q, 1, 30).then((r) => setRows(r.data)).catch(() => setRows([])); }, 250); return () => clearTimeout(t); }, [q]);
  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Chọn khách hàng">
        <div className="modal-head"><h3>Chọn khách hàng</h3><button className="icon-btn" onClick={onClose} aria-label="Đóng">✕</button></div>
        <div className="modal-body">
          <input type="search" autoFocus placeholder="Tìm mã / tên khách hàng…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />
          {!rows ? <div className="skeleton-wrap">{Array.from({ length: 5 }).map((_, i) => <div className="skeleton-row" key={i} />)}</div>
            : rows.length === 0 ? <p className="muted">Không có khách hàng khớp.</p> : (
              <div className="list-wrap">
                <table className="list-table"><tbody>{rows.map((c) => (
                  <tr key={c.id} className="qrow" style={{ cursor: "pointer" }} onClick={() => onPick(c)}>
                    <td><strong>{c.code}</strong></td><td>{c.name}</td><td className="muted">{c.phone || ""}</td>
                  </tr>))}</tbody></table>
              </div>
            )}
        </div>
        <div className="modal-foot"><button className="btn" onClick={onClose}>Đóng</button></div>
      </div>
    </div>
  );
}
