// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import type { InvestigationPhase } from "@/stores/investigation";

export type StepState = "done" | "active" | "waiting" | "todo";

/** Where each step stands for a given phase. `hasReport` marks the last step done. */
export function stepStates(
  phase: InvestigationPhase,
  started: boolean,
  hasReport: boolean,
): StepState[] {
  if (!started) return ["todo", "todo", "todo", "todo"];
  switch (phase) {
    case "searching":
      return ["active", "todo", "todo", "todo"];
    case "validating":
      return ["done", "waiting", "todo", "todo"];
    case "tracing":
      return ["done", "done", "active", "todo"];
    case "traced":
      return ["done", "done", "done", hasReport ? "done" : "todo"];
    case "reporting":
      return ["done", "done", "done", "active"];
    default:
      return hasReport
        ? ["done", "done", "done", "done"]
        : ["active", "todo", "todo", "todo"];
  }
}
