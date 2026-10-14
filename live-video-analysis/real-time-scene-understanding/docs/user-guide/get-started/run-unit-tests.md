# Testing and Coverage

The project uses pytest for unit testing. Tests are located in the [`app/tests/`](https://github.com/open-edge-platform/metro-ai-suite/tree/main/live-video-analysis/real-time-scene-understanding/app/tests) directory.

## Install Test Dependencies

```bash
cd app
uv sync --group dev
```

## Run All Tests

```bash
uv run pytest
```

## Run a Specific Test File

Adjust the file path shown below to run other specific test files (see the `app/tests/` directory for available test files).
The following command runs the tests defined in the `tests/test_frame_registry.py` file:

```bash
uv run pytest tests/test_frame_registry.py
```

## Run Tests with Coverage Report

```bash
uv run pytest --cov=backend --cov=main --cov-report=term-missing
```

## Generate an HTML Coverage Report

```bash
uv run pytest --cov=backend --cov=main --cov-report=html
```

Open `htmlcov/index.html` in a browser to view the detailed coverage report.
