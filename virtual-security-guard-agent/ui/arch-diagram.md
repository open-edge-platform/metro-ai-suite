# UI Codebase Architecture Diagram

```mermaid
flowchart TD
    subgraph Browser
    Browser --> ReactApp["React App (Vite)"]
    end
    ReactApp -->|routing| Routes
    Routes -->|AGENT| Feature_AGENT["/agent/* (Agent Feature)" <br/>Component: AgentHub]
    Routes -->|CAMERAS| Feature_CAMERAS["/cameras/* (Cameras Feature)" <br/>Component: CameraFleetPage]
    Routes -->|MAP| Feature_MAP["/map/* (Map Feature)" <br/>Component: FloorplanPage]
    Routes -->|REPORTS| Feature_REPORTS["/reports/* (Reports Feature)" <br/>Component: ReportsPage]
    Routes -->|SETTINGS| Feature_SETTINGS["/settings/* (Settings Feature)" <br/>Component: SettingsPage]

    subgraph Layout
    AppShell --> Navigation
    Navigation --> Sidebar
    AppShell --> StatusFooter
    AppShell --> VsgMark
    end

    subgraph UI Components
    AppShell -->|includes| UI_BUTTON
    AppShell -->|includes| UI_CARD
    AppShell -->|includes| UI_DIALOG
    AppShell -->|includes| UI_SIDEBAR
    UI_BUTTON -->|shared| UI_SHARED
    end

    subgraph State Stores
    Store_CAMERAS --> CamerasStore
    Store_CAMERA_EXTBE <-- Hermes
    Store_MAP --> FloorplanStore
    Store_REPORTS --> ReportsStore
    Store_INVDN --> InvestigationStore
    Store_TRACE --> TraceStore
    Store_WATCH --> WatchStore
    end

    subgraph Adapters
    HermesAdapter -->|http| HermesHTTP
    HermesAdapter -->|sse| HermesSSE
    HermesAdapter -->|mock| HermesMock
    VSSAdapter -->|http| VSSHTTP
    VSSAdapter -->|mock| VSSMock
    end

    subgraph Protocol
    Protocol_LIVE --> LiveParser
    Protocol_Feed --> DirectivesParser
    end

    %% Relationships
    Feature_AGENT -->|uses| Store_INVDN
    Feature_AGENT -->|uses| Store_WATCH
    Feature_CAMERAS -->|uses| Store_CAMERAS
    Feature_CAMERAS -->|calls| HermesAdapter
    Feature_MAP -->|uses| Store_MAP
    Feature_MAP -->|calls| VSSAdapter
    Feature_REPORTS -->|uses| Store_REPORTS
    Feature_REPORTS -->|calls| HermesAdapter
    Feature_SETTINGS -->|uses| Store_SETTINGS

    %% Hook interactions
    Hooks -->|queries| Store_FOREACH

```
```

This diagram illustrates the major modules and their interactions:
1. **Browser** runs the compiled bundle produced by **Vite**.
2. **ReactApp** is the entry point defined in `main.tsx` and renders **AppShell**.
3. **AppShell** is the top‑level layout composed of **Navigation**, **Sidebar**, **StatusFooter**, and the VSG mark.
4. Routing decides which feature component is rendered:
   - **Agent** – includes live investigation UI, uses `InvestigationStore` and `WatchStore`.
   - **Cameras** – displays camera grids, interacts with `CamerasStore` and the Hermes HTTP adapter.
   - **Map** – handles floorplan visualization, interacts with `FloorplanStore` and the VSS HTTP adapter.
   - **Reports** – document creation and PDF export, pulls data from `ReportsStore`.
   - **Settings** – app configuration UI.
5. **UI components** such as buttons, dialogs, and sidebar are shared across all pages.
6. **State stores** are implemented with **Zustand** and provide reactive state.
7. **Adapters** (`hermes` and `vss`) abstract external service protocols.
8. The **protocol** package contains parsers for directives, live feed updates, and instruction messaging.

Feel free to open `arch-diagram.md` in your editor to view the diagram rendered by any Mermaid previewer.
