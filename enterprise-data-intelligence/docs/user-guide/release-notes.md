# Release Notes: Enterprise Data Intelligence

## Version 2026.3.0

**Release Date**: December 7, 2026

This release moves the knowledge base to the Data Intelligence Engine, updates the Skills to
use it, and redesigns the UI.

**New**:

- **Data Intelligence Engine knowledge base**: replaces EC-RAG as the knowledge base service
  (port `16022`). The engine indexes the uploaded documents and returns the most relevant
  chunks, and the agent writes the answer from them.
- **`data_intelligence_engine` wrapper for the `knowledgebase` Skill**: replaces the `ecrag`
  wrapper and calls the engine retrieval API with `curl`. New options:
  - `--media` limits the search to documents, images, video, or audio.
  - `--rerank N` keeps the best N candidates after reranking.
  - `--library` and `--pool` select a library and asset pools by ID.
  - `--list-pools` lists the library's pools and the asset types they index.

  If no library is configured, the wrapper picks one automatically. Results now show the page
  number and, for figures and media, a download link with the surrounding page text.
- **Visual questions**: with `--include-media`, the `knowledgebase` Skill retrieves images,
  PDF figures, and video frames as local image files with a manifest. The agent can then
  answer questions about what an image or video scene shows, citing the source file and the
  page or frame time.
- **Redesigned UI**:
  - A connection screen signs in to the OpenClaw gateway with a gateway token.
  - The chat view is redesigned, with a starter screen for new tasks and streamed replies.
  - A new Resource Library sidebar shows the Asset Library, the Working Directory, and the
    Media Library. In the Asset Library, you can browse the engine's libraries and choose
    which ones are active for retrieval.

**Improved**:

- **`competitive_analysis_PDF_generator` Skill**: `query_rag.sh` now queries the Data
  Intelligence Engine. You can select the library and pool with `KB_LIBRARY` and `KB_POOL`,
  and pass `top_k` as an optional second argument.
- **UI deployment**: the UI container now runs on a Docker bridge network and reaches host
  services through `host.docker.internal`. The UI reaches the OpenClaw gateway through a
  forwarder on the host. For setup steps, see [Get Started](./get-started.md).
- **System requirements**: 32 GB of system RAM is now the minimum, and 64 GB is recommended.

## Version 2026.2.0

**Release Date**: September 10, 2026

This initial release introduces an agent-native automation platform that combines a local
knowledge base with autonomous agents to complete enterprise tasks end-to-end.

**New**:

- **Integrated agent workflow**: connects a browser-based UI, the OpenClaw agent runtime,
  EC-RAG, and an LLM router with prompt compression in a unified enterprise task workflow.
- **Grounded knowledge retrieval**: uses EC-RAG to retrieve information from an uploadable
  local knowledge base and generate answers grounded in enterprise data.
- **Reusable OpenClaw Skills**: includes a generic `knowledgebase` Skill for queries,
  summaries, comparisons, and structured reports, plus a `competitive_analysis_PDF_generator` Skill for specialized analysis.
- **Competitive-analysis reports**: combines information from the local knowledge base with
  web search to generate professional Chinese HTML and PDF comparison reports.
- **Flexible model access**: routes agent model calls to local vLLM or cloud models and uses
  LinguaCompressor to reduce prompts before dispatch.
- **Containerized UI**: provides a Docker Compose deployment for submitting tasks to OpenClaw
  and viewing generated results in a browser.
