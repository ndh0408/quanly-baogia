// Minimal env defaults so config.js doesn't fail-fast in tests.
process.env.NODE_ENV ||= "test";
process.env.DATABASE_URL ||= "postgresql://quanly:quanly_pwd@localhost:5432/quanly_test?schema=public";
process.env.SESSION_SECRET ||= "test-secret-must-be-long-enough-to-pass-the-zod-validator-yes";
process.env.LOG_LEVEL ||= "error";
