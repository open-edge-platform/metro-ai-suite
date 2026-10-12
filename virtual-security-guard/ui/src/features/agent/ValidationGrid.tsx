// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  Loader2,
  RotateCw,
  SendHorizontal,
} from "lucide-react";
import type { VssHit } from "@/adapters/vss/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { noteForHit, resolveRefs, segmentKey } from "@/lib/hits";
import type { MatchesDirective } from "@/protocol/directives";
import { inlineReviewKey } from "@/stores/investigation.logic";
import {
  sameVerdicts,
  splitVerdicts,
  useConfirmedSightings,
  useHitlStore,
  type Verdict,
} from "@/stores/hitl";
import { useInvestigationStore } from "@/stores/investigation";
import { useSettingsStore } from "@/stores/settings";
import { ClipPlayerDialog } from "./ClipPlayerDialog";
import { MatchCard } from "./MatchCard";
import { useDirectiveHits } from "./useDirectiveHits";
import { useSubmitReview } from "./useSubmitReview";

const EMPTY: Record<string, Verdict> = {};

interface Props {
  data: MatchesDirective;
  /** Agent turn that emitted the grid; keys inline-only results. */
  turnId: string;
  /** False while Argus is busy: verdicts can still change, sending waits. */
  interactive: boolean;
}

/** Matches shown at first (a 3×2 grid on wide screens). */
const PAGE = 6;
/** Most findings a grid can reveal with "Show more". */
const MAX_FINDINGS = 20;

/**
 * Human-in-the-loop review of Argus's potential matches: the top six, with
 * "Show more findings" revealing up to twenty. The operator only confirms;
 * every shown match left unconfirmed is sent as a false positive. Every grid
 * of the session stays reviewable, so sightings found by later searches (e.g.
 * after cropping the person) add to the same confirmed list, which becomes
 * the time-ordered route and the report.
 */
export function ValidationGrid({ data, turnId, interactive }: Props) {
  const { hits, source, query, queryId, isLoading, isRunning, error, refetch } =
    useDirectiveHits(data, turnId);
  const minScore = useSettingsStore((s) => s.minTraceScore);
  const setSubject = useInvestigationStore((s) => s.setSubject);
  const send = useInvestigationStore((s) => s.send);
  const key = queryId ?? inlineReviewKey(turnId);
  const verdicts = useHitlStore((s) => s.verdicts[key] ?? EMPTY);
  const sent = useHitlStore((s) => s.sent[key]);
  const toggle = useHitlStore((s) => s.toggle);
  const replace = useHitlStore((s) => s.replace);
  const registerHits = useHitlStore((s) => s.registerHits);
  const session = useConfirmedSightings();
  const [playing, setPlaying] = useState<VssHit>();
  const [note, setNote] = useState("");
  const total = Math.min(hits.length, MAX_FINDINGS);
  // A grid that was already reviewed reopens with everything it showed.
  const [visible, setVisible] = useState(PAGE);
  const sentCount = sent ? Object.keys(sent).length : 0;
  const count = Math.min(total, Math.max(visible, sentCount));
  const shown = useMemo(() => hits.slice(0, count), [hits, count]);
  const picks = useMemo(
    () => resolveRefs(data.keep, hits) ?? new Set<string>(),
    [data.keep, hits],
  );
  const { submit, sending } = useSubmitReview(key, queryId, hits);

  // Let the session's confirmed list resolve this grid's refs to sightings.
  useEffect(() => {
    if (hits.length) registerHits(key, hits);
  }, [key, hits, registerHits]);

  /** Segments confirmed in other grids show as confirmed here too. */
  const confirmedElsewhere = useMemo(
    () => new Set(session.map(segmentKey)),
    [session],
  );
  const verdictFor = (h: VssHit): Verdict | undefined =>
    verdicts[h.matchId] ??
    (confirmedElsewhere.has(segmentKey(h)) ? "confirm" : undefined);

  /** What saving would send: shown + unconfirmed = false positive. */
  const next = useMemo(() => {
    const out: Record<string, Verdict> = {};
    for (const h of shown)
      out[h.matchId] =
        (verdicts[h.matchId] ??
          (confirmedElsewhere.has(segmentKey(h)) ? "confirm" : undefined)) ===
        "confirm"
          ? "confirm"
          : "reject";
    return out;
  }, [shown, verdicts, confirmedElsewhere]);
  const confirmed = splitVerdicts(next).confirm.length;
  const changed = !sent || !sameVerdicts(next, sent);

  /** A frame was cropped and stored in VSS: make it the subject, then search for it. */
  function onCropSubject(image: { previewUrl: string; imageUrl: string }) {
    setSubject(image);
    toast.success("Cropped person saved to VSS", {
      description: "Searching the footage for that person…",
    });
    void send("Search for the person in this image.", { image });
  }

  function save() {
    replace(key, next);
    void submit({ text: note }).then(() => setNote(""));
  }

  function onVerdict(h: VssHit) {
    // A sighting confirmed in another grid is "confirm" here until changed.
    if (verdicts[h.matchId] === undefined && verdictFor(h) === "confirm")
      useHitlStore.getState().setVerdict(key, h.matchId, "reject");
    else toggle(key, h.matchId, "confirm");
  }

  if (isLoading || isRunning)
    return (
      <section className="border bg-card p-3" aria-busy>
        <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading potential matches
          from VSS
        </p>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {Array.from({ length: PAGE }).map((_, i) => (
            <Skeleton key={i} className="aspect-[4/3.6] rounded-none" />
          ))}
        </div>
      </section>
    );

  if (error)
    return (
      <section className="status-error flex items-center gap-3 border border-[var(--status-border)] bg-[var(--status-bg)] p-3 text-sm text-[var(--status-fg)]">
        <AlertTriangle className="size-4 shrink-0" />
        <span className="flex-1">
          Couldn't load search {queryId} from VSS: {error.message}
        </span>
        <Button size="sm" variant="outline" onClick={() => refetch()}>
          <RotateCw /> Retry
        </Button>
      </section>
    );

  if (!shown.length)
    return (
      <section className="border border-dashed bg-card p-4 text-sm text-muted-foreground">
        VSS returned no sightings for this search. Try a wider time window, more
        cameras or a different description.
      </section>
    );

  return (
    <section className="border bg-card" aria-label="Potential matches">
      <header className="flex items-center gap-3 border-b px-3 py-2">
        {query?.image && (
          <img
            src={query.image}
            alt="Search image"
            className="size-9 shrink-0 object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">
            {shown.length} potential match{shown.length === 1 ? "" : "es"}
            {total > shown.length && (
              <span className="font-normal text-muted-foreground">
                {" "}
                (top {shown.length} of {total})
              </span>
            )}
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            {sent && !changed
              ? "Review sent to Argus. You can still confirm more sightings."
              : "Confirm the sightings that show the subject. Unconfirmed ones count as false positives."}
          </p>
        </div>
        {queryId ? (
          <span className="font-mono text-[0.6875rem] text-muted-foreground">
            {queryId}
          </span>
        ) : source === "inline" ? (
          <span
            className="text-[0.6875rem] text-muted-foreground"
            title="These matches were copied by the agent and could not be checked against VSS."
          >
            unverified
          </span>
        ) : null}
      </header>

      <div className="grid grid-cols-2 gap-2.5 p-3 sm:grid-cols-3">
        {shown.map((h) => (
          <MatchCard
            key={h.matchId}
            hit={h}
            verdict={verdictFor(h)}
            picked={picks.has(h.matchId)}
            note={noteForHit(data.notes, h)}
            minScore={minScore}
            onVerdict={() => onVerdict(h)}
            onPlay={() => setPlaying(h)}
          />
        ))}
      </div>

      {total > shown.length && (
        <div className="flex justify-center px-3 pb-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setVisible(Math.min(total, count + PAGE))}
          >
            <ChevronDown /> Show {Math.min(PAGE, total - shown.length)} more
            finding
            {Math.min(PAGE, total - shown.length) === 1 ? "" : "s"} (
            {shown.length} of {total} shown)
          </Button>
        </div>
      )}

      <footer className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t bg-card/95 px-3 py-2.5 backdrop-blur">
        <p
          className="shrink-0 text-xs whitespace-nowrap text-muted-foreground"
          aria-live="polite"
        >
          <span className="font-semibold text-confirm">
            {confirmed} confirmed
          </span>{" "}
          of {shown.length}
          {session.length > 0 && (
            <span> · {session.length} in this session</span>
          )}
        </p>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note for Argus (optional)"
          className="h-8 min-w-40 flex-1 basis-48 text-xs"
          maxLength={400}
        />
        <Button
          size="sm"
          className="shrink-0 whitespace-nowrap"
          disabled={sending || !interactive || !changed}
          title={
            !interactive ? "Argus is busy; send when it finishes" : undefined
          }
          onClick={save}
        >
          {sending ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
          {!changed
            ? "Review sent"
            : confirmed
              ? sent
                ? `Update review (${confirmed} confirmed)`
                : `Save ${confirmed} confirmed`
              : "None match, refine search"}
        </Button>
      </footer>

      <ClipPlayerDialog
        hit={playing}
        onOpenChange={(o) => !o && setPlaying(undefined)}
        verdict={playing ? verdictFor(playing) : undefined}
        onVerdict={playing ? () => onVerdict(playing) : undefined}
        onCropSubject={onCropSubject}
      />
    </section>
  );
}
