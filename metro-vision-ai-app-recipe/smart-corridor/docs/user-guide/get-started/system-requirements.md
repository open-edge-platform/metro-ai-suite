```{eval-rst}
.. meta::
   :description: Hardware, software, and platform requirements for setting up and running the application.
   :keywords: system requirements, supported platforms, minimum requirements, validated platforms, software requirements, compatibility
```

# System Requirements

This section provides detailed hardware, software, and platform requirements to help you set up
and run the application efficiently.


<!--
## User Stories Addressed
- **US-2: Evaluating System Requirements**
  - **As a developer**, I want to review the hardware and software requirements, so that I can determine if my environment supports the application.

### Acceptance Criteria
1. A detailed table of hardware requirements (e.g., processor type, memory).
2. A list of software dependencies and supported operating systems.
3. Clear guidance on compatibility issues.
-->

## Supported Platforms
<!--
**Guidelines**:
- Include supported operating systems, versions, and platform-specific notes.
-->
**OS**:
- Ubuntu OS version 24.04 LTS
- Ubuntu OS version 26.04 LTS

## Minimum Requirements
<!--
**Guidelines**:
- Use a table to clearly outline minimum and recommended configurations.
-->

| **Component**       | **Minimum Requirement** |
|---------------------|-------------------------|
| **Processor**       | Intel® Core™ Ultra Series 3 Processor (Panther Lake 358H)|
| **Memory**          | 32 GB                   |
| **Disk Space**      | 128 GB SSD              |
| **Accelerator**     | Integrated GPU and NPU  |

## Software Requirements
<!--
**Guidelines**:
- List software dependencies, libraries, and tools.
-->
**Required Software**:

- Docker Engine version 24.0 or higher
- Git
- jq
- unzip

## Compatibility Notes
<!--
**Guidelines**:
- Include any limitations or known issues with supported platforms.
-->
**Known Limitations**:

- GPU optimizations require Intel® integrated graphics or compatible accelerators.

## Validation

- Follow the instructions in [Get Started](../get-started.md).