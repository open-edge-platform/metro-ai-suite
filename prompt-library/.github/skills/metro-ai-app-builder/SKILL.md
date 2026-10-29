---
name: metro-ai-app-builder
description: >-
  Conversational orchestrator that turns an objective into a working Intel Edge
  AI application through one questionnaire — the user states an outcome and may
  optionally specify packaging, API recipe, hardware, and models (or defer each
  with `auto`) — then discovering the relevant Open Edge Platform skills,
  proposing a plan, and building the deliverable by DELEGATING to the right
  skill(s) after you confirm.
license: Apache-2.0
compatibility: >-
  Requires: Node.js 20+ and the `npx skills@1.5.23` CLI
  to add delegate skills on demand; `git`/`gh` and network access to github.com
  to read the live skill index. Individual delegate skills add their own
  requirements (Docker + Compose v2, Intel CPU/GPU/NPU, Kubernetes/Helm, Python)
  — surface those to the user during planning, do not assume them.
metadata:
  author: open-edge-platform
  version: "1.0.0"
  tags: "orchestrator business-objective skill-discovery planning intel edge-ai"
allowed-tools: bash git gh
---

# Metro AI App Builder — objective-to-app orchestrator

You are the **single owner of this conversation**. The user states an
outcome (e.g. *"I want to detect people in my camera feeds"*, *"I want to search
my video archive"*, *"I want a chatbot over my PDFs"*). Your job is to turn that
into a running Intel Edge AI application. The user may speak in **business**
terms, in **technical** terms, or a mix — accept whatever they give. You:

1. **Ask a single questionnaire** — outcome, data/inputs, deployment target,
   scale, plus the optional technical axes (**packaging type, API recipe,
   target HW, models & videos**). Any technical axis the user does not care about
   they answer with `auto`, and you decide it.
2. **Discover** the relevant skill(s) from the curated objective mappings and
   the upstream `skills-config.json` index (see
   [`references/SKILL_CATALOG.md`](references/SKILL_CATALOG.md) and
   [`references/DISCOVERY.md`](references/DISCOVERY.md)).
3. **Propose a plan** — deliverable, which skill(s) will build it, and the
   technology you inferred — and **wait for explicit confirmation**.
4. **Build only after approval** by delegating to the chosen skill(s). Nothing
   is created before the user confirms.

> Guiding rule: the user may specify technology or defer it. Accept explicit
> technical answers (packaging, API recipe, device, model) **and** accept `auto`
> on any axis — for every deferred axis you infer the choice from the other
> answers + the catalog. Never *force* a technology question the user has
> deferred; never *refuse* one they want to make.

## When to use this skill

Use this skill for any *"I want to `<outcome>` on Intel edge"* request — running
one questionnaire (what outcome you want, your inputs, where it runs, and
optionally the packaging, API recipe, hardware, and models) — when you do **not**
already know which specific skill to run. Specifically:

- The user describes a **desired outcome** on Intel edge but has **not** named a
  concrete skill (this is the default entry point for the prompt library).
- The objective may span multiple domains (vision, RAG, video search, model
  prep, training, robotics) and you must **route** to the right one.
- The user asks *"what can I build?"* or *"how do I do X on Intel?"* and needs a
  guided path.

Typical objectives this skill routes: detect/count/track objects in camera
feeds, spatial multi-camera analytics, video search & summarization,
conversational Q&A / RAG over documents, multimodal data preparation and
embeddings, model download/conversion and training, manufacturing-quality and
time-series applications, OEP component lifecycle, UAV mission compute, and
Physical AI policy workflows.

**Do not** use this skill when the user already named a specific skill (invoke
that skill directly) or wants a pure code answer with no deployable artifact.

## Reference files (load on demand)

| File | Load when |
|---|---|
| [`references/SKILL_CATALOG.md`](references/SKILL_CATALOG.md) | Mapping an objective → the delegate skill(s). Load in Step 2 (Discover). |
| [`references/APP_SPEC.md`](references/APP_SPEC.md) | The four optional technical axes (packaging, API recipe, target HW, models & videos), their `auto`/defer semantics, and how each maps to a delegate. Load in Step 1 when the user gives — or you need to infer — any technical axis. |
| [`references/API_RECIPES.md`](references/API_RECIPES.md) | What each API recipe (DL Streamer, OV+OpenCV, OVMS+FFmpeg) is and which **delegate skill / code path** it routes to. Load in Step 2 when the API-recipe answer drives routing. |
| [`references/DISCOVERY.md`](references/DISCOVERY.md) | Confirming/refreshing the live catalog, checking which skills are installed, and adding a skill with `npx skills@1.5.23`. Load in Step 2 when the catalog is stale or a skill is missing locally. |

Do **not** load delegate skills' bodies yourself up front — you hand off to them
in Step 5 and *they* load their own references. During planning, inspect only
the selected delegate's compatibility and parameter requirements so the plan
does not promise unsupported settings (for example, FP16 when INT8 is required).

## Procedure

### Step 1 — Understand the objective (Q&A)

Ask only unanswered items from these **four plain-language questions in one
batch**. Offer defaults; accept `defaults` or empty answers to use them (this
does not replace Step 4 approval). If all answers are known, skip the questionnaire.

1. **Goal** — what should the app detect, explain, or do? For alerts, include
   when to notify and where notifications should appear.
2. **Inputs** — cameras, sample video, documents, dataset, or robot/policy?
   For live cameras, default to ONVIF. For multiple cameras, ask whether views
   are independent or require tracking across cameras; the latter routes to
   Scenescape.
3. **Where to run** — this device or another host/cluster, and which output
   folder? [this device, Docker Compose, a dedicated subfolder]
4. **Scale and experience** — how many inputs, live or batch, and dashboard
   or API? [one input and domain-appropriate UI; balanced accuracy/latency]

Offer one **optional** preferences field: packaging (demo/service/function/port),
Intel CPU/GPU/NPU, API recipe (DL Streamer/OpenVINO + OpenCV/OVMS + FFmpeg), or
model. Omitted preferences mean `auto`; do not ask four extra technical questions.
Infer them from the answers and catalog, honor explicit choices, and show resolved
values in the plan. Use CPU/GPU/NPU names only, not hardware generations.
For alerts, state the trigger (appearance vs sustained presence), cooldown, and
destination in the plan; MQTT publication alone is not an operator notification.
For sample-video demos, prefer licensed, simple fixed-camera footage with clear
target objects. For threshold alerts, select footage whose real counts naturally
cross the requested threshold; do not lower it or inject detections to force proof.

### Step 2 — Discover the relevant skill(s)

Load [`references/SKILL_CATALOG.md`](references/SKILL_CATALOG.md) and map the
answers to one **primary** skill (and any **supporting** skills, e.g. a
model-download or embedding-serving step). If the objective is ambiguous or the
catalog looks stale, load [`references/DISCOVERY.md`](references/DISCOVERY.md) to
refresh the live index and check what is already installed. When the **API
recipe** is specified, load [`references/API_RECIPES.md`](references/API_RECIPES.md)
— it takes precedence for media/analytics routing. Routing summary:

| Objective / answer (what the user says) | Route to |
|---|---|
| API recipe = **DL Streamer**, or "build/port a DL Streamer pipeline or simple vision app" | **`dlstreamer-coding-agent`** (the DLS skill) — **not** the recipe stack |
| API recipe = **OpenVINO + OpenCV** | OpenVINO custom-code path (per OpenVINO docs) + `model-download-user` for the IR |
| API recipe = **OVMS + FFmpeg** | OVMS model-serving path + `model-download-user` (OVMS-ready IR) + FFmpeg glue code |
| Packaging = **microservice / full end-to-end** analytics stack + dashboard (detection/counting/zone alerts) | **`metro-ai-app-recipe`** (end-to-end DLSPS + WebRTC + Node-RED + Grafana stack) |
| Packaging = **demo/PoC** app that just proves a model runs and emits detections (single lightweight vision app, no full stack) | **`dlstreamer-coding-agent`** |
| "Multi-camera / spatial / cross-camera tracking of a scene" (whole-scene view) | **`scenescape-setup`** (directly — multi-camera spatial analytics) |
| "Build a custom vision pipeline / sample app in code" | **`dlstreamer-coding-agent`** |
| "Migrate / convert / port an NVIDIA DeepStream pipeline to Intel DL Streamer" | **`dlstreamer-coding-agent`** |
| "Chatbot / Q&A / RAG over my documents" — Docker | **`chatqna-docker-deploy`**; Kubernetes → **`chatqna-helm-deploy`** |
| "Search / summarize my video library" | **`vss-deploy`** (+ `vss-search-index` / `vss-summarize-video`); k8s → **`vss-deploy-helm`** |
| "Embed text/images/videos for similarity search" | **`multimodal-embedding-serving-user`** |
| "Prepare / ingest videos and images for retrieval" | **`multimodal-dataprep-user`** |
| "Download / convert a model for inference/OVMS" | **`model-download-user`** |
| "Train / fine-tune / export / quantize a CV model" | **`getitune-*`** (Geti model library), **`geti-using-the-pipeline`** (Geti app), or **`anomalib-training`** (anomaly detection) |
| "Train / export / benchmark / run a Physical AI policy" | **`pai-train-policy`**, **`pai-export-policy`**, **`pai-benchmark-policy`**, **`pai-load-policy`**, **`pai-run-policy`** |
| Manufacturing-quality application | **`manufacturing-ai-app-builder`** → `manufacturing-app-recipe` |
| "Install / start / stop an OEP module or profile" | **`openedge-cli`** |
| "Build a time-series analytics use case" | **`time-series-analytics-user`** |
| UAV Mission Compute SDK setup / operation | **`uav-mission-compute-sdk`** |

If nothing fits, say so plainly and suggest the closest catalog entry or a
custom-code path — do not invent a skill.

### Step 3 — Decide the deliverable & infer technology

From the answers decide the shape of the deliverable (demo/PoC app vs
microservice/end-to-end stack vs function/batch job vs port vs cluster deploy vs
training run vs model artifact) and **infer every deferred (`auto`) technical
parameter** the chosen delegate needs (model, class filter, precision, device,
topics, compose vs helm, mode flags, etc.), while carrying through any parameter
the user specified. The delegate skill defines exactly which parameters it
consumes — prepare them so the hand-off in Step 5 needs no further questions.

### Step 4 — Propose the plan and WAIT for confirmation

Present a concise plan and **stop for approval**. Include:

- **Deliverable** — what will exist when done (directory/service/URLs/artifacts).
  Resolve the absolute output directory before approval. If it does not exist,
  include its creation in the plan; after approval, create it before any workspace
  switch. Never switch to a nonexistent directory or repeat an approved workspace
  choice unless the host requires it.
- **Primary + supporting skill(s)** and why each was chosen.
- **Inferred technology** — the concrete model/device/mode/topics you selected,
  shown as *decisions you made*, not questions.
- **Requirements/assumptions** — Docker/Helm, GPU groups, ports, network, tokens
  (e.g. `HF_TOKEN`) — surfaced from the delegate's `compatibility`.
- **Any skill that must be installed** with the exact `npx skills@1.5.23 add` command.
- **Deployment-target alternative** — whenever the chosen delegate has a
  Kubernetes/Helm sibling (`chatqna-helm-deploy` for `chatqna-docker-deploy`,
  `vss-deploy-helm` for `vss-deploy`), always add a one-line *"on Kubernetes →
  use `<helm-skill>`"* note, even when the user picked Docker, so the cluster
  path is visible.
- **Follow-on path** — when the deliverable is an intermediate artifact rather
  than a running app (e.g. a trained/exported/quantized model IR from the
  `getitune-*` pipeline, or a downloaded/converted model), always state the
  natural next step that turns it into something usable (e.g. deploy the IR via
  `model-download-user` → `metro-ai-app-recipe`), offered as the obvious
  follow-on.
- **Next action on approval** — close the plan with one explicit line naming
  what you will do the moment the user says `go`: *delegate to `<primary skill>`
  (then the supporting skills, in order) and verify the result against that
  delegate's own completion criteria* (health checks, a sample query, validation
  metrics — whatever the delegate defines). State this as your committed next
  step even though you build nothing yet, so the hand-off and verification are
  unambiguous.

Do **not** create or modify any files, download anything, or start containers
until the user replies with an affirmative (`go`, `yes`, `build it`, `approved`).
If they change an answer, re-plan and re-confirm.

### Step 5 — Build by delegating

Only after confirmation:

1. Ensure the chosen skill(s) are available. If a delegate is not already
   installed in the session, add it (see
   [`references/DISCOVERY.md`](references/DISCOVERY.md)):

   Use the skill's `repo`, `ref`, `path`, and `name` from `skills-config.json`:
   ```bash
   npx skills@1.5.23 add https://github.com/<owner>/<repo>/tree/<ref>/<path>/<skill-name>
   ```
   Verify that the configured path exists on the selected ref and use any
   per-skill path override. If it is stale, discover the actual skill folder in
   that repository before installing; do not assume every delegate is in
   `open-edge-platform/skills`.
   Verify the installed `SKILL.md` exists. If invocation reports "not found"
   despite a successful installation, use the host's supported skill refresh;
   if unavailable, explicitly read and follow the installed skill in context.
   Do not reinstall repeatedly or request another workspace just to refresh it.

2. **Invoke the delegate skill**, passing the parameters you inferred in Step 3.
   Pass one resolved application specification including the approved output
   directory, inputs, model/precision, device, and alert behavior. Reuse it rather
   than repeating the questionnaire; re-confirm any required change to the plan.
   Let it own the build — do not re-implement its work by hand. Chain supporting
   skills in dependency order (e.g. `model-download-user` →
   `metro-ai-app-recipe`; `multimodal-dataprep-user` → `vss-*`).
3. Relay only the **business-relevant** progress to the user; keep the technical
   chatter to the delegate.

### Step 6 — Verify and hand back

Verify against the **delegate skill's own completion criteria** (each delegate
ships its own). Then summarize for the user in business terms: what was built,
how to reach it (URLs/commands), and the immediate next action (e.g. "open the
Grafana dashboard", "ask the chatbot a question", "run a search query"). If a
step fails, report the failing delegate step and stop — do not loop.
Distinguish verified, failed, and unverified outcomes; a passing test count
does not override a failed user-facing completion criterion. Include start,
stop, and status commands and whether services remain running.

## Examples

See [`example-prompts/`](example-prompts/) for end-to-end walk-throughs:
- `01-vision-detection.md` — camera detection → `metro-ai-app-recipe`.
- `02-document-chatbot.md` — RAG over PDFs → `chatqna-docker-deploy`.
- `03-video-search.md` — search a video archive → `vss-deploy` + `vss-search-index`.
- `04-train-a-model.md` — train a detector → `getitune-*`.
- `05-ambiguous-discovery.md` — vague objective → discovery + clarify + route.
- `06-deepstream-to-dlstreamer.md` — migrate an NVIDIA DeepStream pipeline →
  `dlstreamer-coding-agent`.
- `07-developer-technical-axes.md` — user specifies the technical axes
  (OVMS+FFmpeg microservice, `auto` HW/model) → OVMS path via `model-download-user`.

## Edge cases

- **User names a skill directly** → skip discovery; hand off to that skill.
- **Objective spans two skills** (e.g. train *then* deploy) → sequence them in
  the plan and confirm the whole pipeline once.
- **No catalog match** → say so; offer the closest entry or a custom path; never
  fabricate a skill name or capability.
- **User declines the plan** → adjust the business answers and re-propose; build
  nothing until approved.
- **Missing prerequisite** (no Docker, no GPU, no `HF_TOKEN`) → surface it in the
  plan (Step 4) and let the user decide, rather than failing mid-build.

## Notes

- This skill wraps the prompt library (`metro-ai-suite/prompt-library`); the minimal
  `prompts/*.yaml` files state only a business objective and hand off here.
- Vision objectives split three ways: **`metro-ai-app-recipe`**
  (`metro-ai-suite/metro-vision-ai-app-recipe/.github/skills/metro-ai-app-recipe/`,
  in this same repository) builds the **end-to-end** analytics stack;
  **`scenescape-setup`** handles **multi-camera / spatial** whole-scene analytics
  directly; **`dlstreamer-coding-agent`** builds a **quick demo / simple** or
  custom-code vision app. Resolve every external delegate's source repository
  from the current `skills-config.json`; the index is not limited to
  `open-edge-platform/skills`.
- Keep the catalog in [`references/SKILL_CATALOG.md`](references/SKILL_CATALOG.md)
  in sync with the upstream `skills-config.json` — see
  [`references/DISCOVERY.md`](references/DISCOVERY.md).
