# Record Loitering Clips with Stream Manager

The optional **Stream Manager overlay** records the original camera stream whenever someone
loiters and saves it as an MP4 clip. Use it to keep video evidence of each loitering event,
without recording the cameras all the time.

The overlay adds two services to the application:

- **Stream Manager** (`stream-manager`): an Intel microservice that ingests the RTSP camera
  streams, keeps a short rolling buffer of each, and records or extracts video on request.
- **Loitering Event Recorder** (`loitering-event-recorder`): a small sidecar that watches the
  loitering messages on MQTT and drives Stream Manager through its REST API.

## Enable the overlay

Install the application with the `loitering-detection-sm` argument instead of
`loitering-detection`. Run the commands from the `metro-vision-ai-app-recipe` directory:

```bash
./install.sh loitering-detection-sm
docker compose up -d
./sample_start.sh
```

To select a specific host IP address, append it: `./install.sh loitering-detection-sm <HOST_IP>`.

> [!NOTE]
> The overlay and the Console UI (`loitering-detection-ui`) are separate installation choices
> and cannot be combined. The Console UI launches its own pipelines on separate MQTT topics
> (`object_tracking_<id>`), which the recorder does not watch.

To go back to the default application, run `./install.sh loitering-detection` again.

## How it works

Every sample video is looped into an RTSP stream by the default application
(`rtsp://rtsp-server:8554/cam-<N>`), and the DL Streamer Pipeline Server reads those streams.
(The Console UI installation does not start the RTSP services and reads the video files
directly.)
Stream Manager reads the same streams, so the clip is cut from the original video, without the
detection overlay.

1. At startup, the recorder registers each camera in Stream Manager (`POST /v1/streams`).
   Stream Manager then keeps a rolling buffer of the last 30 seconds of each stream.
2. The MQTT Table Flattener publishes one row per second for every object whose dwell time is
   at or above the loitering threshold, on `object_tracking/<N>/loiterstatus`.
3. When a camera has a loiterer and no recording is open, the recorder starts one
   (`POST /v1/records/start`), beginning 5 seconds before the threshold was crossed.
4. The recording stays open while anyone on that camera is loitering. 3 seconds after the last
   loiterer disappears, the recorder stops it (`POST /v1/records/stop`).
5. When the recording is ready, the recorder downloads the clip
   (`GET /v1/retrieve/{recording-id}/clip`), saves it, adds a line to the event index and
   deletes the recording from Stream Manager.

### Recording strategy

The recorder uses **one recording session per camera**, not one per person.

| Situation | What happens |
|-----------|--------------|
| First person starts loitering on an idle camera | A recording starts, with `PRE_EVENT_SEC` (5 s) of footage from before the threshold was crossed. |
| More people start loitering while the recording is open | They join the same session. No new recording or API call is made. |
| Everyone on the camera stops loitering | The recording stops after `STOP_GRACE_SEC` (3 s). The grace period absorbs short tracking drop-outs and keeps close events in one clip. |
| Someone starts loitering after the session has stopped | A new, independent session starts, with its own clip. The previous clip can still be downloading. |
| A session reaches `MAX_SESSION_SEC` (300 s) while people are still loitering | The recording is stopped and a continuation starts immediately, without pre-roll. The segment number in the event index links the clips. Set `MAX_SESSION_SEC=0` to disable the limit. |
| The stream was only just registered, so the buffer is shorter than the pre-roll | The recording starts without the pre-roll. |

Example for one camera:

| Time | Event | Recording |
|------|-------|-----------|
| 0 s | Person A crosses the threshold | Session 1 starts, with footage from 5 s earlier |
| 20 s | Person B crosses the threshold | Joins session 1 |
| 50 s | Both have left | Grace period starts |
| 53 s | Grace period over | Session 1 stops, clip is saved |
| 90 s | Person C crosses the threshold | Session 2 starts, with footage from 5 s earlier |

Stream Manager starts a recording at the keyframe at or before the requested time, so a clip
can start up to about a second earlier than requested. Consecutive segments of a split session
therefore overlap by up to about a second.

## Where the clips are saved

Clips are saved on the host, in `loitering-detection/clips/`, next to the application:

```text
loitering-detection/clips/
├── events.jsonl
├── cam-1/
│   └── 20261111T052135Z_yoCu8wB3SpquVTXkoQninQ.mp4
└── cam-2/
    └── ...
```

- Each clip is named `<UTC start time>_<recording id>.mp4` and is in a folder per camera
  (`cam-<N>` matches the stream number of `object_tracking/<N>`).
- The folder is a bind mount, so clips remain after `docker compose down -v`. The folder is not
  tracked by git.
- **Nothing deletes old clips.** Remove or archive them yourself.

`events.jsonl` has one JSON line per recording, listing every loitering object in it:

```json
{
  "recording_id": "yoCu8wB3SpquVTXkoQninQ",
  "camera": "cam-1",
  "clip": "cam-1/20261111T052135Z_yoCu8wB3SpquVTXkoQninQ.mp4",
  "start_ts": "2026-11-11T05:21:35.649643284Z",
  "end_ts": "2026-11-11T05:22:05.679277563Z",
  "segment": 0,
  "pre_event_sec": 5.0,
  "tracks": [
    {
      "track_id": 7,
      "zone": "region1",
      "type": "person",
      "detected_at": "2026-11-11T05:21:40.807966Z",
      "last_seen_at": "2026-11-11T05:22:02.227687Z",
      "max_dwell_sec": 25.0
    }
  ]
}
```

- `start_ts` and `end_ts` are the clip boundaries, in UTC.
- `detected_at` is when the recorder first saw the object over the threshold, and `last_seen_at`
  the last time. `max_dwell_sec` is the longest dwell time reported for the object.
- `segment` is `0` for a first recording and increases for each continuation of a split session.
  `pre_event_sec` is the pre-roll that was actually used (`0` for a continuation).
- A `warning` field is added when Stream Manager reports a problem, for example a recording
  that was cut short because its storage was full.

Stream Manager keeps its own copy of each recording in the `stream-manager-data` Docker volume
until the clip is saved. With the default `DELETE_REMOTE_AFTER_DOWNLOAD=true` it is then removed,
because Stream Manager never expires recordings and would eventually run out of space
(`507 storage_full`).

## Configure the recording

Edit the values in the `.env` file in the `metro-vision-ai-app-recipe` directory, then apply
them:

```bash
docker compose up -d
```

| Variable | Default | Description |
|----------|---------|-------------|
| `PRE_EVENT_SEC` | `5` | Seconds of footage kept before the loitering threshold is crossed. Must not exceed `SM_BUFFER_LENGTH`. |
| `STOP_GRACE_SEC` | `3` | Seconds without any loiterer on a camera before its recording is stopped. |
| `MAX_SESSION_SEC` | `300` | Length at which a session is split into a new recording. `0` means no limit. |
| `DELETE_REMOTE_AFTER_DOWNLOAD` | `true` | Delete the recording from Stream Manager once the clip is saved. |
| `SM_BUFFER_LENGTH` | `30` | Seconds of rolling history Stream Manager keeps per stream (5 to 300). It only limits the pre-roll, not the recording length. |
| `CAMERA_IDS` | `1,2,3,4` | Stream numbers to record. Each `N` is read from `rtsp://rtsp-server:8554/cam-N`. |
| `LOITERING_THRESHOLD_SEC` | `5.0` | Dwell time that counts as loitering. It is applied by the MQTT Table Flattener and must match the pipeline threshold. |
| `STREAM_MANAGER_IMAGE` | `intel/stream-manager:latest` | Stream Manager image. |
| `STREAM_MANAGER_SHM_SIZE` | `1g` | Shared memory for the stream buffers. Docker's default of 64 MB is too small. |
| `RTSP_FEEDER_CODEC_ARGS` | libx264, keyframe every 30 frames, no B-frames | ffmpeg arguments for the looped sample videos (see below). |
| `RTSP_SOURCES` | `true` | Set by `install.sh` (`false` for the Console UI installation): whether `sample_start.sh` reads the RTSP streams or the video files. Do not edit. |

## Requirements and limitations

- **Stream requirements.** Stream Manager only accepts RTSP or RTSPS streams with a single
  H.264 or H.265 video track and **no credentials in the URL**. The camera must send NTP-based
  RTCP sender reports, and its clock must agree with the host. It rejects streams with sparse
  or irregular keyframes and streams whose timestamps jump by more than a second.
- **Sample videos are re-encoded.** Stream Manager did not accept three of the four sample
  videos when they were copied as they are (`-c copy`); their keyframes are about 8 seconds
  apart. The default `RTSP_FEEDER_CODEC_ARGS` therefore re-encodes them with a keyframe every
  30 frames and no B-frames. This uses a little over one CPU core for the four streams. Each
  camera has its own `rtsp-stream-<N>` container, because a stall in a shared ffmpeg process at
  the loop restart made Stream Manager reject every stream.
- **Streams do not reconnect.** If a stream fails, Stream Manager does not reconnect it. The
  recorder detects this, deletes the stream and registers it again. A recording in progress at
  that moment is lost.
- **Restarts.** If Stream Manager restarts while a recording is open, that recording is
  discarded.
- **Trigger precision.** The flattener only reports the first zone of an object and publishes
  once per second, so a recording can start up to about a second after the threshold was
  crossed. The 5 s pre-roll is counted from that moment, not from when the person entered the
  zone.
- **Overlapping people.** One clip can contain several unrelated people. Use `events.jsonl` to
  see which objects are in which clip.
- **No authentication.** Stream Manager has no authentication or TLS. In this application it
  is only reachable inside the Docker network, and no port is published.
- **Resources.** Allow about 1 GB of shared memory and extra disk space for the clips. A clip
  of 30 seconds is about 10 MB.

## Use your own RTSP cameras

To record your own cameras, start the pipelines with your own RTSP URLs instead of the looped
sample videos. Set `"uri"` in the `source` of the launch payload (see `sample_start.sh`), and
make Stream Manager read the same URLs by changing the `RTSP_URL_TEMPLATE` value of the
`loitering-event-recorder` service in `loitering-detection/compose-stream-manager-overlay.yml`
(`{id}` is replaced by each number in `CAMERA_IDS`). Make sure the cameras meet the stream
requirements above.

## Troubleshooting

See [Troubleshooting Stream Manager and RTSP streams](../troubleshooting.md#troubleshooting-rtsp-streams-and-clip-recording).
