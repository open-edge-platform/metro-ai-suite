// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { createBrowserRouter, Navigate } from "react-router";
import { AppShell } from "@/components/layout/AppShell";
import { CameraFleetPage } from "@/features/cameras/CameraFleetPage";
import { FloorplanPage } from "@/features/map/FloorplanPage";
import { ReportsPage } from "@/features/reports/ReportsPage";
import { SettingsPage } from "@/features/settings/SettingsPage";

export const routes = [
  {
    path: "/",
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate to="/argus" replace /> },
      // Rendered by AppShell (kept alive); the route entry keeps the URL valid.
      { path: "argus", element: null },
      { path: "cameras", element: <CameraFleetPage /> },
      { path: "floorplan", element: <FloorplanPage /> },
      { path: "reports", element: <ReportsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "*", element: <Navigate to="/argus" replace /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
