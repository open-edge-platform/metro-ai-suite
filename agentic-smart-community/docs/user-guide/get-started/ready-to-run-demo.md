# Ready-to-Run Demo

Run Smart Community end to end with an open-source video.

All files are in [examples/venue-monitor](https://github.com/open-edge-platform/metro-ai-suite/tree/release-2026.3.0/agentic-smart-community/examples/venue-monitor).

## Prerequisites

Finish the [Prerequisites](../get-started.md#prerequisites) and [Step 1 - Start all services](../get-started.md#step-1---start-all-services) in Get Started.

## Start

From the component root (`agentic-smart-community`):

```bash
# Optional, in China: use the Hugging Face mirror.
export HF_ENDPOINT=https://hf-mirror.com

bash examples/venue-monitor/start-demo.sh
```

If the demo is already running, it is stopped first and then started again.
This downloads the video, pushes it as `rtsp://localhost:8010/live/venue`, starts the stack, and registers the `venue_monitor` use case and the `cam_venue` monitor.

> [!NOTE]
> For a Chinese prompt (descriptions and reports in Chinese), run `PROMPT_LANG=zh bash examples/venue-monitor/start-demo.sh` instead.

## Verify

```bash
ffprobe -rtsp_transport tcp rtsp://localhost:8010/live/venue
curl -fsS http://localhost:3101/health
```

Open `http://localhost:3100/` and select `cam_venue` to see the live preview.

## Connect with OpenClaw agent

Follow [Get Started - Step 3](../get-started.md#step-3---connect-an-agent-host) to install the OpenClaw on host, and then register the MCP server with OpenClaw.

## Create the agent and enable alerts

```bash
bash examples/venue-monitor/openclaw-adapter/install.sh
```

This creates `venue-monitor-agent` and routes `cam_venue` alerts to it.
Run `openclaw dashboard` to open the Control UI (`http://localhost:18789`), where alerts appear in the agent's session.

## Schedule a daily report

| Cron job | Schedule | Agent | Session | Behavior |
| -------- | -------- | ----- | ------- | -------- |
| `venue-daily-report-22` | Daily at 22:30 | `venue-monitor-agent` | `daily_report` | Generates the daily report for `cam_venue`: foot-traffic statistics and abnormal events. |

Replace `Asia/Shanghai` with your timezone:

```bash
openclaw cron add --name venue-daily-report-22 --cron "30 22 * * *" --tz Asia/Shanghai \
  --agent venue-monitor-agent --session "session:daily_report" --session-key agent:venue-monitor-agent:daily_report \
  --no-deliver --message "Generate today's daily report for cam_venue."
```

## Talk with the agent

In the Control UI, select `venue-monitor-agent` and ask, for example:

- "What is happening on `cam_venue` right now?"
- "Were there any alerts on `cam_venue` today?"
- "Generate today's report for `cam_venue`."

## Stop

```bash
bash examples/venue-monitor/stop-demo.sh
```

This stops the stream and the app tier, and keeps the model serving warm.
To stop everything, run `bash setup_docker.sh --down`.

## Learn More

### Use case

`venue_monitor` classifies each clip and counts the distinct people in it (`people_count`, stored in the database and used for the daily report's foot-traffic statistics); `warn` events raise alerts.

| Event             | Severity |
| ----------------- | -------- |
| `fight`           | warn     |
| `fall`            | warn     |
| `running`         | warn     |
| `multiple_people` | info     |
| `person_present`  | info     |
| `empty`           | info     |

The prompts are in [prompts](https://github.com/open-edge-platform/metro-ai-suite/tree/release-2026.3.0/agentic-smart-community/examples/venue-monitor/prompts).
Re-running with a different `PROMPT_LANG` updates the registered prompt.

### Video source

By default, [people-detection.mp4](https://github.com/intel-iot-devkit/sample-videos/blob/master/people-detection.mp4) is downloaded from Intel's open-source `sample-videos` repository on the first run.

Use your own local video (any file `ffmpeg` can read, H.264 recommended):

```bash
VIDEO_FILE=/absolute/path/to/video.mp4 bash examples/venue-monitor/start-demo.sh
```

Use an existing RTSP stream (nothing is pushed; `cam_venue` reads your URL):

```bash
RTSP_URL=rtsp://<host>:<port>/<path> bash examples/venue-monitor/start-demo.sh
```

### Stream settings

`PLAYS_PER_HOUR` controls the pushed video (default `6`; not used with `RTSP_URL`):

| Value | Behavior                                                                  |
| ----- | ------------------------------------------------------------------------- |
| `N`   | Play `N` times per hour; the last frame is held between plays             |
| `-1`  | Loop continuously, no hold (a very large `N`, 72+ for this video, does the same) |
| `0`   | Play once                                                                 |

```bash
PLAYS_PER_HOUR=12 bash examples/venue-monitor/start-demo.sh
```

To change only the stream, run `examples/venue-monitor/stop-stream.sh`, then `examples/venue-monitor/start-stream.sh`.
