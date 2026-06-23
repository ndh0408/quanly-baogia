import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// Đặt theme NGAY (module script — qua được CSP, khác inline script bị chặn). Đọc cùng key "theme"
// với app cũ → đồng bộ sáng/tối giữa 2 app. Chạy trước render để hạn chế nháy.
try {
  const t = localStorage.getItem("theme");
  if (t === "dark" || (!t && matchMedia("(prefers-color-scheme: dark)").matches))
    document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.setAttribute("data-theme", "light");
} catch { /* ignore */ }

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
