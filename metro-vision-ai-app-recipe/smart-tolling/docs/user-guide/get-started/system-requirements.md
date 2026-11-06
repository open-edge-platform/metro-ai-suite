# System Requirements

This section provides detailed hardware, software, and platform requirements to help you set up and run the application efficiently.

## Supported Platforms

**Operating Systems**
- Ubuntu 24.04 LTS
- Ubuntu 26.04 LTS

## Minimum Requirements

| **Component**       | **Minimum Requirement** |
|---------------------|-------------------------|
| **Processor**       | Intel® Core™ Ultra Processor (Series 1 and above) or Intel® Core™ Processor Series 3, with Intel® HD Graphics   |
| **Memory**          | 16 GB                   |
| **Disk Space**      | 128 GB SSD              |
| **GPU/Accelerator** | Integrated GPU          |
| **NPU**             | Required for LPR OCR and vehicle color classification |

### Validated Platforms

| Product / Family     | CPU |  iGPU |  NPU |
|----------------------|-----------|------------|-----------|
| Intel® Core™ Ultra Processors (Series 3, 2, 1) | ✓         | ✓          | ✓         |
| Intel® Core™ Processors Series 3 | ✓         | ✓          | ✓         |

**Validated on Intel® Arc™ dGPU models:** A770, B580, B60, and B50.

> [!NOTE]
> Users can also create apps tailored to their use case using models supported by DL Streamer.
> Check [the list of supported models](https://docs.openedgeplatform.intel.com/dev/edge-ai-libraries/dlstreamer/supported_models.html) for the latest information.

## Software Requirements

**Required Software**:
- Docker 29.5 or higher
- Git, unzip

## Accelerator Requirements

The default pipeline configuration hardcodes `device=GPU` for detection/tracking and
`device=NPU` for color classification and license-plate OCR in `config.json`. A system
without these accelerators cannot run the pipeline as shipped.

## Validation

- Ensure all dependencies are installed and configured before proceeding to [Get Started](../get-started.md).
