import "dotenv/config";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import path from "node:path";
import { fileURLToPath } from "node:url";

import authRoutes from "./routes/auth.routes.js";
import usersRoutes from "./routes/users.routes.js";
import quotesRoutes from "./routes/quotes.routes.js";
import exportRoutes from "./routes/export.routes.js";
import metaRoutes from "./routes/meta.routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PgSession = connectPgSimple(session);

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    store: new PgSession({
      conObject: { connectionString: process.env.DATABASE_URL },
      createTableIfMissing: true,
      tableName: "user_sessions",
    }),
    secret: process.env.SESSION_SECRET || "dev-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      httpOnly: true,
      sameSite: "lax",
    },
  })
);

app.use("/api/auth", authRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/quotes", quotesRoutes);
app.use("/api/export", exportRoutes);
app.use("/api/meta", metaRoutes);

// Health
app.get("/api/health", (req, res) => res.json({ ok: true, t: new Date() }));

// Static frontend
app.use(express.static(path.join(__dirname, "..", "public")));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message || "Lỗi server" });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`🚀 Server chạy tại http://localhost:${port}`);
});
