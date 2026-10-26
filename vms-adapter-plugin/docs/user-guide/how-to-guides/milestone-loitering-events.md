# Loitering Events and Alarms in Milestone XProtect

This guide shows how to turn the Loitering Detection app's loitering occurrences
into **analytics events** and **alarms** in Milestone XProtect, through Milestone
AI Bridge and the VMS Adapter Plugin (VAP).

Bounding-box overlays and loitering events are separate features:

| Feature | AI Bridge topic | Shown in |
|---|---|---|
| Detection boxes | `{app_id}-metadata` (`ONVIF_ANALYTICS_FRAME`) | Smart Client live and playback video |
| Loitering events | `{app_id}-events` (`ANALYTICS_EVENT`) | Alarm Manager, rules, event logs |

## How it works

```
Loitering Detection pipeline
   └─► mqtt-table-flattener ──► {prefix}/{vendor}:{camera}/loiterstatus   (one row per loiterer)
         └─► VAP ──► POST ANALYTICS_EVENT ──► AI Bridge {app_id}-events ──► XProtect Event Server
                                                                              └─► Alarm definition ──► Alarm Manager
```

1. The recipe's `mqtt-table-flattener` sidecar publishes a row for every
   person whose dwell time in a zone exceeds `LOITERING_THRESHOLD_SEC`
   (default 5 s). It repeats the row about once a second while the person
   keeps loitering.
2. VAP turns every row into an analytics event and posts it to the app's
   `{app_id}-events` topic. For the default app, that is `dls_vision-events`.
3. AI Bridge forwards the event to the XProtect Event Server.
4. An **alarm definition** in Management Client raises an alarm for each event.

Each event looks like this in XProtect:

| Field | Value |
|---|---|
| Name | `Loitering detected` (fixed, so alarms and rules can select it) |
| Description | e.g. `pedestrian 12 loitering 6.0s in zone region1` |
| Source | The camera the pipeline runs on |
| Object | The loiterer, as the triggering object. With an outline and a mapped class (e.g. `Human`) when VAP has seen the person's box in the last 5 s; otherwise the detector label only |

## Prerequisites

- VAP registered with AI Bridge, with Loitering Detection configured. See
  [Milestone XProtect via Milestone AI Bridge](./milestone-ai-bridge.md).
- A Loitering Detection pipeline started through VAP on a Milestone camera, and
  the recipe's `mqtt-table-flattener` running.
- Administrator access to XProtect Management Client.

## Step 1: Enable events in VAP

In `config/config.yaml`, under the `object_detection` app:

```yaml
analytics_apps:
  - type: object_detection
    app_id: "dls_vision"
    # Publish every row on "<metadata topic>/<event_topic_suffix>" as an analytics event.
    events_enabled: true
    # Must match the flattener's DEST_TOPIC_SUFFIX.
    event_topic_suffix: "${DLS_EVENT_TOPIC_SUFFIX:-loiterstatus}"
```

`event_bookmark_enabled: true` is still accepted as a deprecated alias.

Optional, under the Milestone instance's `vendor_options`:

```yaml
vms_instances:
  - name: milestone
    vendor: milestone
    vendor_options:
      # Minimum seconds between events for the same camera and person.
      # 0 or omitted sends every row (about one event per second per loiterer).
      event_min_interval_s: 10
```

Recreate the backend so the change is loaded and the app is re-registered:

```bash
docker compose up -d --force-recreate backend
```

## Step 2: Check the event topic in AI Bridge

On startup VAP registers the Loitering Detection app with both topics. The app
GUID does not change, so re-registration updates the existing app in XProtect
rather than adding a new one.

Confirm the events topic and its endpoint in the AI Bridge GraphQL API:

```graphql
query { eventTopics { appID topicName eventFormat topicAvailability { rest } } }
```

Expected:

```json
{"topicName": "dls_vision-events", "eventFormat": "ANALYTICS_EVENT",
 "topicAvailability": {"rest": "http://<aib-host>:8382/event/<app-guid>/dls_vision-events/analytics_event"}}
```

Unlike detection metadata, events are delivered without ticking the topic on
the camera's **Processing server** tab.

## Step 3: Define the analytics event in Management Client

1. In **Tools → Options → Analytics Events**, make sure analytics events are
   **enabled**. If address filtering is on, allow the AI Bridge host.
2. Go to **Rules and Events → Analytics Events**, right-click, and choose
   **Add New**.
3. Set **Name** to exactly `Loitering detected`. XProtect matches incoming
   events by name, so case and spacing must be identical.
4. Save.

## Step 4: Create the alarm definition

1. Go to **Alarms → Alarm Definitions**, right-click, and choose **Add New**.
2. Fill in:

   | Field | Value |
   |---|---|
   | Name | e.g. `Loitering` |
   | Triggering event | **Analytics Events** → **Loitering detected** |
   | Sources | The cameras running Loitering Detection, or all cameras |
   | Time profile | **Always**, or your own schedule |
   | Related cameras | The same cameras, so the alarm opens with video |
   | Priority / category | As required |

3. Save.

Alarms are only raised for events that arrive after the definition is saved.

## Step 5: View alarms in Smart Client

Open the **Alarm Manager** tab. Each loitering event raises an alarm showing
the event name and description. Select an alarm to see the related video and
the loiterer's outline.

## Verify the flow

VAP logs one line per event:

```bash
docker logs -f vms-adapter-backend 2>&1 | grep loitering_event_published
# loitering_event_published camera_id=milestone:<dev>/<stream> result=True track_id=12 with_box=True
```

AI Bridge logs each delivery to XProtect:

```bash
docker logs -f <aibridge-proxy-container> 2>&1 | grep "Sending analytics event"
# Sending analytics event to 'http://<management-server>:22331/Central/AlarmServiceToken' succeeded.
```

## Troubleshooting

| Symptom | Check |
|---|---|
| No `loitering_event_published` in VAP logs | `events_enabled: true`; the flattener is running and its `DEST_TOPIC_SUFFIX` matches `event_topic_suffix`; the pipeline was started through VAP (topic `{prefix}/milestone:{dev}~{stream}`). Rows are only published once someone loiters longer than the threshold. |
| `result=False` in VAP logs | The `dls_vision-events` topic is missing in AI Bridge: restart the backend to re-register, then repeat Step 2. |
| AI Bridge logs `succeeded` but no alarm | The analytics event name is exactly `Loitering detected`; analytics events are enabled and the AI Bridge host is allowed; the alarm's sources include the camera. |
| Too many alarms | VAP sends one event per row, about one per second per loiterer. Set `vendor_options.event_min_interval_s`. |
| Alarm has no outline | VAP had not seen that person's box on the metadata topic in the previous 5 s (`with_box=False` in the log). |

## Nx Witness

With the same `events_enabled` setting, Nx Witness receives each row as a
bookmark named `<type> <track> loitering <dwell>s in zone <zone>`, unchanged from
earlier releases.

## Loitering zone overlay

The zones configured for the app (`zones` in `config.yaml`, e.g. `region1`)
are drawn on the camera video in Smart Client as a box labelled with the
zone's `label`, alongside the detection boxes. They are sent in the metadata
topic, not in the events. As on Nx Witness, the zone is sent on every pipeline
frame, so it stays visible when nobody is detected.

Box colors are assigned automatically per class, and are not configurable:
people (`Human`) blue, vehicles red, zones amber, and other classes from a fixed
palette. A class keeps its color across restarts, and distinct classes get
distinct colors until the 12-color palette is used up.

Keep each zone's `bounding_box` in sync with the pipeline's own zone
definition, so the drawn box matches where loitering is measured.

When a run starts, VAP scales `default_zone_polygon` to the camera's resolution
and sends it to `gvaanalytics` as the zone. Pipelines that expose a
`roi-properties` parameter (a named `gvaattachroi` element, used with
`gvadetect inference-region=1`) also get the zone's bounding rectangle as their
ROI, so detection and loitering use the same region on every resolution. The
attached ROI itself carries no label; VAP does not send it to the VMS, since the
zone overlay already shows it.
