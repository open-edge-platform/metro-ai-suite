// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { env } from "@/config/env";
import { managerPath, toDatastorePath } from "@/lib/urls";
import { normalizeStoredQuery, normalizeStream } from "./normalize";
import {
  SEARCH_IMAGE_MAX_BYTES,
  SEARCH_IMAGE_TYPES,
  VssError,
  type VssAdapter,
} from "./types";

type Json = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Accept: "application/json", ...init?.headers },
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg = (body as Json | undefined)?.message;
    throw new VssError(
      Array.isArray(msg)
        ? msg.join("; ")
        : String(msg ?? `VSS ${res.status} ${res.statusText}`),
      res.status,
    );
  }
  return body as T;
}

/** VSS Pipeline Manager client via the same-origin `/vss` prefix. */
export function createHttpVss(base: string = env.vssBase): VssAdapter {
  const m = (p: string) => managerPath(p, base);
  const setWatch = (queryId: string, watch: boolean) =>
    getJson(m(`/search/${encodeURIComponent(queryId)}/watch`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watch }),
    }).then(() => undefined);
  return {
    async health() {
      try {
        const res = await fetch(m("/health"), { cache: "no-store" });
        return res.ok;
      } catch {
        return false;
      }
    },

    async features() {
      const f = await getJson<Json>(m("/app/features"));
      return {
        search: f.search === "FEATURE_ON",
        summary: f.summary === "FEATURE_ON",
        imageSearch:
          typeof f.imageSearchEnabled === "boolean"
            ? f.imageSearchEnabled
            : undefined,
      };
    },

    async listTags() {
      const tags = await getJson<unknown>(m("/tags"));
      return Array.isArray(tags)
        ? tags.filter((t): t is string => typeof t === "string").sort()
        : [];
    },

    async getQuery(queryId) {
      const q = await getJson<Json | undefined>(
        m(`/search/${encodeURIComponent(queryId)}`),
      );
      // VSS answers 200 with an empty body for unknown ids.
      if (!q || typeof q !== "object" || !q.queryId)
        throw new VssError(`Search ${queryId} not found`, 404);
      return normalizeStoredQuery(q);
    },

    async uploadImage(file, filename = "query.jpg") {
      if (!SEARCH_IMAGE_TYPES.includes(file.type))
        throw new VssError("Use a JPEG, PNG or WebP image.");
      if (file.size > SEARCH_IMAGE_MAX_BYTES)
        throw new VssError("Images must be 2 MB or smaller.");
      const form = new FormData();
      form.append("image", file, filename);
      const body = await getJson<Json>(m("/search/images"), {
        method: "POST",
        body: form,
      });
      const imageUrl = String(body.imageUrl ?? body.imagePath ?? "");
      if (!imageUrl) throw new VssError("VSS did not return an image URL.");
      return {
        imageId: typeof body.imageId === "string" ? body.imageId : undefined,
        imageUrl,
        previewUrl: toDatastorePath(imageUrl, base) ?? imageUrl,
      };
    },

    async listStreams() {
      const body = await getJson<Json>(m("/streams"));
      const list = Array.isArray(body?.streams) ? (body.streams as Json[]) : [];
      return list.map(normalizeStream).filter((s) => s.streamId);
    },

    async addStream(input) {
      const body: Json = { stream_url: input.streamUrl.trim() };
      if (input.name?.trim()) body.stream_name = input.name.trim();
      if (input.description?.trim())
        body.description = input.description.trim();
      if (input.tags?.length) body.tags = input.tags;
      if (input.frameInterval) body.frame_interval = input.frameInterval;
      if (input.objectDetection !== undefined)
        body.enable_object_detection = input.objectDetection;
      if (input.start !== undefined) body.start = input.start;
      await getJson(m("/streams"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },

    async updateStream(id, patch) {
      const body: Json = {};
      if (patch.state) body.state = patch.state;
      if (patch.name !== undefined) body.stream_name = patch.name.trim();
      if (patch.description !== undefined)
        body.description = patch.description.trim();
      if (patch.tags) body.tags = patch.tags;
      if (patch.frameInterval) body.frame_interval = patch.frameInterval;
      if (patch.objectDetection !== undefined)
        body.enable_object_detection = patch.objectDetection;
      await getJson(m(`/streams/${encodeURIComponent(id)}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },

    async removeStream(id) {
      await getJson(m(`/streams/${encodeURIComponent(id)}`), {
        method: "DELETE",
      });
    },

    async startWatch(req) {
      const body: Json = req.imageUrl
        ? { imageUrl: req.imageUrl }
        : { query: req.query?.trim() };
      if (!req.imageUrl && !req.query?.trim())
        throw new VssError("Describe the person or attach a photo to watch.");
      if (req.tags?.length) body.tags = req.tags.join(",");
      if (req.windowMinutes)
        body.timeFilter = {
          value: req.windowMinutes,
          unit: "minutes",
          source: "relative",
        };
      const created = await getJson<Json>(m("/search"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const queryId = str(created?.queryId);
      if (!queryId) throw new VssError("VSS did not return a query id.");
      await setWatch(queryId, true);
      return queryId;
    },

    setWatch,

    async refreshConfig() {
      try {
        const c = await getJson<Json>(m("/search/refresh-config"));
        const ms = typeof c?.intervalMs === "number" ? c.intervalMs : 10_000;
        return { enabled: c?.enabled !== false, intervalMs: ms };
      } catch {
        return { enabled: true, intervalMs: 10_000 };
      }
    },
  };
}
