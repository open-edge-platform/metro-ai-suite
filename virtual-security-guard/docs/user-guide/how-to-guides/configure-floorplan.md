<!--
SPDX-FileCopyrightText: (C) 2026 Intel Corporation
SPDX-License-Identifier: Apache-2.0
-->

# Configure the Floorplan

The **Floorplan** page draws your cameras, their fields of view and the
subject's route. VSG ships with a **Level 4 (sample)** plan. Upload your own
plan as JSON; it is stored in the browser.

![Floorplan page with the sample plan](../_assets/floorplan.jpg "Floorplan")

## 1. Get a template

Click **Samples** and download either:

- **Minimal example (3 cameras)**, or
- **Level 4 sample with zones**.

## 2. Write the plan

The minimal plan only needs camera positions:

```json
{
  "cameras": {
    "entry_cam_1": { "x": 120, "y": 450, "zone": "Lobby", "fov_angle": 90 }
  }
}
```

Coordinates are SVG units, origin top-left, `y` pointing down.

| Field | Required | Meaning |
|---|---|---|
| `cameras.<key>` | yes | One entry per camera. Use the VSS camera tag as the key, or set `camera_id`. |
| `cameras.<key>.x`, `.y` | yes | Camera position. |
| `cameras.<key>.zone` | no | Zone name shown on the map and in reports. |
| `cameras.<key>.fov_angle` | no | Field-of-view width in degrees (1–360). |
| `cameras.<key>.heading` | no | Viewing direction in degrees: `0` = right/east, `90` = down/south. |
| `cameras.<key>.range` | no | Length of the field-of-view wedge. |
| `cameras.<key>.camera_id` | no | VSS camera tag, when the key is not the tag. |
| `cameras.<key>.label` | no | Display label. |
| `name` | no | Plan name. |
| `canvas` | no | `{ "width": …, "height": … }`. |
| `background` | no | `data:image/…` URI or a same-origin path. Remote URLs are rejected. |
| `zones` | no | `[{ "name": …, "rect": {x,y,w,h} }]` or `points` polygons; `outdoor: true` draws a dashed outline. |
| `walls` | no | List of polylines `[[x,y], [x,y], …]`. |

Plans are limited to 5 MB.

## 3. Upload and map cameras

1. Click **Upload JSON** and choose the file.
2. Click **Map cameras**. For each **Plan camera**, pick the **VSS camera**
   it represents (or **Not mapped**), then **Done**.
3. Click a camera on the map to see its details. Click **Use sample** to go
   back to the sample plan.

Camera tags come from VSS video tags (for example
`P_Lev_4_Entry_Way_ip_107`). A sighting is drawn only if its camera is on the
plan.
