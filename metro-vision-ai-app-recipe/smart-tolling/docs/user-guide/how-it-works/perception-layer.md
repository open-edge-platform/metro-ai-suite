# The Perception Layer

The core of the system is the **DL Streamer Pipeline Server**, which orchestrates
three parallel pipelines defined in `config.json`.

## Pipeline Strategy

| Pipeline Name | Camera View | Primary Adapter | Key Models |
| :--- | :--- | :--- | :--- |
| **`toll-front-l`** / **`toll-front-r`** | Front LPR (left/right lane) | `sscape_adapter_lpr_max_tracking.py` | `vehicle_front_rear`, `licenseplate_cropped`, `paddle_ocr_v4` |
| **`toll-rear-l`** / **`toll-rear-r`** | Rear LPR (left/right lane) | `sscape_adapter_lpr_max_tracking.py` | `vehicle_front_rear`, `licenseplate_cropped`, `paddle_ocr_v4` |
| **`toll-side-l1`** / **`toll-side-l2`** | Side Profile (lane 1/2) | `sscape_adapter_side_max_tracking.py` | `vehicle_type`, `axle`, `color_int8_latest` |

## Algorithm Logic

### A. Smart Axle Counting (`sscape_adapter_side_max_tracking.py`)

Counting wheels is easy; counting *taxable* wheels is hard. Our adapter implements physics-based logic:

1. **IoU Deduplication:**
   - *Problem:* A slow-moving truck might trigger multiple detections for the same wheel.
   - *Solution:* We apply Intersection-over-Union (IoU) filtering. If extensive
     overlap (>40%) is detected between wheel bounding boxes, only the highest confidence detection is kept.

2. **Ground Contact Physics (Lift Axle Detection):**
   - *Problem:* Trucks often lift axles to save tires. These should not be taxed.
   - *Solution:* The algorithm calculates a dynamic "Ground Plane" `($Y_{ground}$)`
     based on the lowest points of the vehicle body and clearly grounded wheels.
   - *Logic:*

     ```text
     $$ Wheel_{status} = \begin{cases} Grounded, & \text{if } Y_{wheel\_bottom} \ge Y_{ground} - \text{Tolerance} \\ Lifted, & \text{otherwise} \end{cases} $$
     ```

   - *Result:* The payload reports `wheels_touching_ground` separately from `wheel_count`.

### B. Multi-View Image Fusion & Optimizations

The system captures evidence from all angles to create a complete "Vehicle Package".
Instead of sending raw video streams, adapters encode "Evidence Crops" as
**Base64 strings** directly inside the JSON MQTT payload.

## Learn More

- [Optimizations](./optimization.md)
- [Analytics Pipeline](../how-it-works.md)
- [Support and Troubleshooting](../troubleshooting.md)
