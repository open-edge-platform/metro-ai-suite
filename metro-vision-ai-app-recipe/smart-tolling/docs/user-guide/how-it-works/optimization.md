# Optimization

The system achieves high-throughput processing on Edge hardware through two key optimizations
defined in `config.json`.

## Dynamic ROI Inference (Hierarchical Execution)

To maximize efficiency, heavy neural networks (like Axle Counting) do not run on the full 4K frame.

- **Logic:** The "Vehicle Type" model runs first to find the bounding box.
- **Optimization:** The Axle model is configured with `inference-region=roi-list`,
  forcing it to execute *only* within the coordinates of the detected vehicle.

## Hybrid Workload Distribution

The pipeline maps models to available accelerators to prevent resource contention:

- **GPU:** Detection and tracking (Vehicle Detection, LPR Detection, Axle Counting).
- **NPU:** Classification (Vehicle Color, License Plate OCR).
- **CPU:** Post-processing adapters (`gvapython`).

## Learn More

- [Perception Layer](./perception-layer.md)
- [Analytics Pipeline](./analytics-pipeline.md)
- [Support and Troubleshooting](../troubleshooting.md)
