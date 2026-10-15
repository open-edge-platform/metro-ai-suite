// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { Check } from "lucide-react";
import type { InvestigationPhase } from "@/stores/investigation";
import { cn } from "@/lib/utils";
import { stepStates } from "./phase";

const STEPS = [
  { id: "search", label: "Assist" },
  { id: "review", label: "Review" },
  { id: "trace", label: "Live search" },
  { id: "report", label: "Report" },
] as const;

/** Numbered progress through the investigation loop. */
export function PhaseStepper({
  phase,
  started,
  hasReport,
  orientation = "horizontal",
}: {
  phase: InvestigationPhase;
  started: boolean;
  hasReport: boolean;
  orientation?: "horizontal" | "vertical";
}) {
  const states = stepStates(phase, started, hasReport);
  const vertical = orientation === "vertical";
  return (
    <ol
      className={cn(
        "flex text-xs",
        vertical ? "flex-col gap-2" : "items-center gap-1",
      )}
      aria-label="Investigation progress"
    >
      {STEPS.map((s, i) => {
        const st = states[i];
        return (
          <li
            key={s.id}
            className={cn(
              "flex items-center gap-2",
              !vertical && i > 0 && "pl-1",
            )}
            aria-current={
              st === "active" || st === "waiting" ? "step" : undefined
            }
          >
            {!vertical && i > 0 && (
              <span
                className={cn(
                  "h-px w-4",
                  st === "todo" ? "bg-border" : "bg-brand-accent",
                )}
                aria-hidden
              />
            )}
            <span
              className={cn(
                "flex size-5 shrink-0 items-center justify-center border text-[0.6875rem] font-semibold tabular-nums",
                st === "done" &&
                  "border-brand-accent bg-brand-accent text-white",
                st === "active" && "border-brand-accent text-brand-accent",
                st === "waiting" &&
                  "border-pending bg-pending/15 text-foreground",
                st === "todo" && "border-border text-muted-foreground",
              )}
            >
              {st === "done" ? <Check className="size-3" /> : i + 1}
            </span>
            <span
              className={cn(
                st === "todo"
                  ? "text-muted-foreground"
                  : "font-medium text-foreground",
              )}
            >
              {s.label}
              {st === "waiting" && (
                <span className="ml-1 font-normal text-muted-foreground">
                  waiting for you
                </span>
              )}
              {st === "active" && (
                <span className="ml-1 inline-block size-1.5 rounded-full bg-brand-accent align-middle motion-safe:animate-pulse" />
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
