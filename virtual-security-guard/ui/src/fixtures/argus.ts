// SPDX-FileCopyrightText: (C) 2026 Intel Corporation
// SPDX-License-Identifier: Apache-2.0
import { lastDirective } from "@/protocol/parser";

export interface ScriptedReply {
  tools: { tool: string; args: string; preview: string }[];
  text: string;
}

const fence = (name: string, body: unknown) =>
  "```" + name + "\n" + JSON.stringify(body) + "\n```";

const MCP = "mcp__video_search_mcp__";

export const MOCK_REPORT = {
  v: 1,
  title: "Person in blue jacket, Level 4 walk-through",
  preset: "handover",
  summary:
    "A person in a blue jacket arrived at the external lift foyer, crossed the seating area, walked along the Entry Way past Lift 6 and the Main Entry, and was last seen in the lift foyer. Six sightings across six cameras were confirmed or traced.",
  subject:
    "Blue zip jacket, dark trousers, no visible bag. Walks at a normal pace and does not interact with anyone.",
  timeline: [
    { ref: "m5", note: "Waiting at the external lift foyer." },
    { ref: "m6", note: "Crosses the external seating area towards the doors." },
    { ref: "m2", note: "Walks along the Entry Way." },
    { ref: "m4", note: "Passes Lift 6 without stopping." },
    { ref: "m1", note: "Seen at the Main Entry, operator confirmed." },
    { ref: "m3", note: "Last seen in the lift foyer." },
  ],
  observations: [
    "No restricted doors were opened in the traced footage.",
    "Ordering follows VSS ingest time, which may differ from recording time.",
  ],
  actions: [
    "Keep the six clips for 30 days.",
    "Ask the day shift to check the lift foyer camera for later footage.",
  ],
  confidence: "medium",
  vss_query_id: "mock-q-trace",
};

/** Deterministic Argus behaviour for offline demos and tests. */
export function scriptedReply(input: string): ScriptedReply {
  const feedback = lastDirective(input, "feedback");
  if (feedback) {
    if (feedback.data.confirm.length) {
      return {
        tools: [
          {
            tool: `${MCP}vss_search_video`,
            args: `{"image":"${feedback.data.anchor_image_url ?? "anchor.jpg"}","limit":16}`,
            preview: '{"query_id":"mock-q-trace","hits":7}',
          },
        ],
        text: [
          `Tracing the confirmed person (${feedback.data.confirm.join(", ")}) across the other cameras with the anchor frame.`,
          "Six sightings clear the score threshold, from the external lift foyer to the lift foyer.",
          "",
          fence("vsg-track", {
            v: 1,
            vss_query_id: "mock-q-trace",
            anchor: feedback.data.confirm[0],
            keep: ["m1", "m2", "m3", "m4", "m5", "m6"],
            note: "Route ordered by ingest time.",
          }),
        ].join("\n"),
      };
    }
    return {
      tools: [
        {
          tool: `${MCP}vss_search_video`,
          args: '{"query":"person in a blue zip jacket, dark trousers","limit":16}',
          preview: '{"query_id":"mock-q-search-2","hits":4}',
        },
      ],
      text: [
        "Understood, none of those were right. I narrowed the description and excluded the rejected clips.",
        "",
        fence("vsg-matches", {
          v: 1,
          vss_query_id: "mock-q-search-2",
          keep: ["m1", "m2", "m3", "m4"],
          note: "Narrower description, rejected clips excluded.",
        }),
      ].join("\n"),
    };
  }

  if (/\breport\b|handover|escalat|summar/i.test(input)) {
    return {
      tools: [
        {
          tool: "skill_view",
          args: '{"name":"vsg-incident-report"}',
          preview: "Loaded skill vsg-incident-report",
        },
      ],
      text: [
        "Here is a handover report built from the confirmed and traced sightings. Review it before you export the PDF.",
        "",
        fence("vsg-report", MOCK_REPORT),
      ].join("\n"),
    };
  }

  return {
    tools: [
      {
        tool: "skill_view",
        args: '{"name":"virtual-security-guard"}',
        preview: "Loaded skill virtual-security-guard",
      },
      {
        tool: `${MCP}vss_list_tags`,
        args: "{}",
        preview: '["P_Lev_4_Entry_Way_ip_107", "P_Lev_4_Main_Entry_ip_54", …]',
      },
      {
        tool: `${MCP}vss_search_video`,
        args: '{"query":"person in a blue jacket","limit":16}',
        preview: '{"query_id":"mock-q-search","hits":8}',
      },
    ],
    text: [
      "I searched all 12 Level 4 cameras. Six sightings look strong; two are weaker and one may not show a person at all.",
      "Please confirm the right person or mark false positives.",
      "",
      fence("vsg-matches", {
        v: 1,
        vss_query_id: "mock-q-search",
        keep: ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"],
        note: "Top six score 0.6 or higher.",
        notes: { m7: "No person detected in the best frame." },
      }),
    ].join("\n"),
  };
}
