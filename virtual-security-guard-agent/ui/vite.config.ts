// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type ProxyOptions } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

/**
 * Dev-server proxy mirroring the production nginx BFF (ui/nginx/default.conf.template):
 *   /hermes/*         -> HERMES_BASE_URL       (Authorization injected server-side)
 *   /vss/manager/*    -> VSS_BASE_URL/manager
 *   /vss/datastore/*  -> VSS_BASE_URL/datastore
 * HERMES_API_KEY is read without the VITE_ prefix so it is never bundled into the SPA.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const hermes = env.HERMES_BASE_URL || "http://127.0.0.1:8642";
  const vss = env.VSS_BASE_URL || "http://127.0.0.1:12345";

  const hermesProxy: ProxyOptions = {
    target: hermes,
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/hermes/, ""),
    headers: env.HERMES_API_KEY
      ? { Authorization: `Bearer ${env.HERMES_API_KEY}` }
      : undefined,
    configure: (proxy) => {
      // Hermes rejects browser Origins it has not allowlisted (CORS is off).
      proxy.on("proxyReq", (req) => req.removeHeader("origin"));
      proxy.on("proxyRes", (res) => {
        if ((res.headers["content-type"] ?? "").includes("text/event-stream")) {
          res.headers["cache-control"] = "no-cache";
          res.headers["x-accel-buffering"] = "no";
        }
      });
    },
  };

  return {
    plugins: [react(), tailwindcss()],
    // Tailwind runs as a Vite plugin; an inline config also stops PostCSS from
    // picking up a stray postcss.config.js from a parent directory.
    css: { postcss: { plugins: [] } },
    resolve: {
      alias: { "@": path.resolve(import.meta.dirname, "./src") },
    },
    server: {
      port: 5173,
      proxy: {
        "/hermes": hermesProxy,
        "/vss": {
          target: vss,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/vss/, ""),
          configure: (proxy) => {
            proxy.on("proxyReq", (req) => req.removeHeader("origin"));
            proxy.on("proxyRes", (res, req) => {
              if (/^\/vss\/datastore\/.*\.mp4(\?|$)/i.test(req.url ?? ""))
                res.headers["content-type"] = "video/mp4";
            });
          },
        },
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      css: false,
      include: ["src/**/*.test.{ts,tsx}"],
    },
  };
});
