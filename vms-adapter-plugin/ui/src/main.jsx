// Copyright (C) 2025 Intel Corporation
// SPDX-License-Identifier: Apache-2.0

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import CameraDashboardPage from './components/CameraDashboard/CameraDashboardPage.jsx'
import { parseEmbedRoute } from './utils/embedRoute'

const embed = parseEmbedRoute();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {embed
      ? <CameraDashboardPage cameraId={embed.cameraId} appId={embed.appId} />
      : <App />}
  </StrictMode>,
)
