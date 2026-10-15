// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { useEffect, useState } from "react";
import type { VssHit } from "@/adapters/vss/types";
import { getThumbnail } from "@/lib/thumbnails";

export type ThumbState =
  | { status: "loading" }
  | { status: "ready"; src: string }
  | { status: "error" };

/** Poster for a sighting: mock still, or a grabbed frame at the best timestamp. */
export function useThumbnail(
  hit: Pick<VssHit, "posterUrl" | "playbackUrl" | "seekS"> | undefined,
): ThumbState {
  const [state, setState] = useState<ThumbState>(() =>
    hit?.posterUrl
      ? { status: "ready", src: hit.posterUrl }
      : { status: "loading" },
  );
  const url = hit?.playbackUrl;
  const poster = hit?.posterUrl;
  const seek = hit?.seekS ?? 0;
  useEffect(() => {
    if (poster) {
      setState({ status: "ready", src: poster });
      return;
    }
    if (!url) {
      setState({ status: "error" });
      return;
    }
    let alive = true;
    setState({ status: "loading" });
    getThumbnail(url, seek).then(
      (src) => alive && setState({ status: "ready", src }),
      () => alive && setState({ status: "error" }),
    );
    return () => {
      alive = false;
    };
  }, [url, poster, seek]);
  return state;
}
