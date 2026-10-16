import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      DATA_DIR: "./test-data",
      SQLITE_FILE: "./test-data/test.db",
      XRAY_ENABLED: "false",
      DISABLE_UPDATE_CHECK: "true",
      PANEL_SECRET: "test-secret-0123456789abcdefghijklmnop",
      AGENT_SECRET: "test-agent-secret",
      COOKIE_INSECURE: "true",
      LOG_LEVEL: "error",
      TELEGRAM_BOT_TOKEN: "",
    },
  },
});
