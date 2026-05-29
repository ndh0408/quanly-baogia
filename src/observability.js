// Sentry + Prometheus integration. Both are no-ops when their env vars are unset,
// so the app boots cleanly in dev without any external services.

import * as Sentry from "@sentry/node";
import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from "prom-client";
import { config } from "./config.js";
import { logger } from "./logger.js";

// === Sentry ===
let sentryReady = false;
export function initSentry() {
  if (!process.env.SENTRY_DSN) return false;
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: config.NODE_ENV,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
    profilesSampleRate: Number(process.env.SENTRY_PROFILES_SAMPLE_RATE || 0),
    beforeSend(event) {
      // Strip cookies + auth headers from events
      if (event.request?.headers) {
        delete event.request.headers.cookie;
        delete event.request.headers.authorization;
      }
      return event;
    },
  });
  sentryReady = true;
  logger.info("Sentry initialized");
  return true;
}

export function captureError(err, ctx) {
  if (!sentryReady) return;
  try {
    Sentry.captureException(err, ctx ? { extra: ctx } : undefined);
  } catch {}
}

// === Prometheus ===
export const registry = new Registry();
registry.setDefaultLabels({ app: "quanly-baogia", env: config.NODE_ENV });
collectDefaultMetrics({ register: registry });

export const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "HTTP requests by method/route/status",
  labelNames: ["method", "route", "status"],
  registers: [registry],
});
export const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request latency",
  labelNames: ["method", "route", "status"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});
export const quoteOpsTotal = new Counter({
  name: "quote_operations_total",
  help: "Quote lifecycle events (create/approve/reject/send)",
  labelNames: ["op", "status"],
  registers: [registry],
});
export const exportJobsTotal = new Counter({
  name: "export_jobs_total",
  help: "Export jobs by format and status",
  labelNames: ["format", "status"],
  registers: [registry],
});
export const sseClients = new Gauge({
  name: "sse_clients",
  help: "Number of connected SSE clients",
  registers: [registry],
});

/**
 * Express middleware that records request latency. Mount AFTER routing so that
 * req.route is populated; for routes that don't match any handler we tag as "unknown".
 */
export function metricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const dur = Number(process.hrtime.bigint() - start) / 1e9;
    const route = req.route?.path || req.baseUrl + (req.route?.path || "") || "unknown";
    const labels = { method: req.method, route, status: String(res.statusCode) };
    httpRequestsTotal.inc(labels);
    httpRequestDuration.observe(labels, dur);
  });
  next();
}
