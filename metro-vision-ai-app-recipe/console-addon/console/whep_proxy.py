#!/usr/bin/env python3
# SPDX-FileCopyrightText: (C) 2026 Intel Corporation
# SPDX-License-Identifier: Apache-2.0
"""WHEP signalling proxy and stream readiness."""

import re

import requests
from flask import Response, abort, jsonify, request

from config import MEDIAMTX_URL, app

_WHEP_METHODS = ["OPTIONS", "GET", "POST", "PATCH", "DELETE"]

# peer_id and session arrive as Flask route segments and are later
# concatenated both into the upstream MediaMTX URL and into this proxy's own
# Location response header. MediaMTX path/session identifiers are always
# short opaque tokens, so a conservative charset is sufficient and does
# not restrict legitimate use.
_SAFE_SEGMENT_RE = re.compile(r"^[A-Za-z0-9_.-]{1,128}$")

# WHEP/WHIP responses only ever carry SDP, ICE trickle fragments, or JSON
# errors. Blindly forwarding whatever Content-Type the upstream happens to
# send would let a compromised or malicious upstream make the browser
# render the response body as e.g. "text/html", turning the reflected
# resp.content into a cross-site scripting vector. Only pass through
# content types this proxy actually expects.
_ALLOWED_CONTENT_TYPES = {
    "application/sdp",
    "application/trickle-ice-sdpfrag",
    "application/json",
}


def _is_safe_segment(value):
    return bool(value) and bool(_SAFE_SEGMENT_RE.match(value))


def _safe_content_type(content_type):
    if not content_type:
        return None
    base = content_type.split(";", 1)[0].strip().lower()
    return content_type if base in _ALLOWED_CONTENT_TYPES else None


def _proxy_whep(upstream_url, peer_id):
    excluded = {"host", "content-length"}
    headers = {k: v for k, v in request.headers.items() if k.lower() not in excluded}
    try:
        # upstream_url is MEDIAMTX_URL (trusted config) with peer_id/session
        # appended, both already restricted to _SAFE_SEGMENT_RE by every
        # caller - the host is never attacker-controlled.
        resp = requests.request(  # nosemgrep: python.django.security.injection.ssrf.ssrf-injection-requests.ssrf-injection-requests,python.flask.security.injection.ssrf-requests.ssrf-requests
            request.method,
            upstream_url,
            headers=headers,
            data=request.get_data(),
            timeout=15,
            allow_redirects=False,
        )
    except requests.RequestException as exc:
        return jsonify({"error": str(exc)}), 502

    out_headers = [("Access-Control-Expose-Headers", "Link, Location")]
    # The Link header carries the ICE server list; without it the browser
    # gathers only host candidates and video never starts remotely.
    link_val = resp.headers.get("Link")
    if link_val:
        out_headers.append(("Link", link_val))

    location = resp.headers.get("Location")
    if location:
        # The upstream Location names the session resource used for ICE
        # trickle (PATCH) and teardown (DELETE), typically
        # "/<peer_id>/whep/<session>". Rewrite it onto this proxy's own
        # route while preserving the session identifier: take the segment
        # following "/whep/" and emit "whep/<peer_id>/<session>". Dropping
        # the session breaks every subsequent PATCH/DELETE. The session
        # token is attacker-influenceable (it comes from the upstream HTTP
        # response), so it is validated against a strict safe charset
        # before being reflected back into our own response header -
        # otherwise it could be used for header injection or XSS.
        session_seg = location.rsplit("/whep/", 1)[-1]
        if _is_safe_segment(session_seg):
            out_headers.append(("Location", "whep/%s/%s" % (peer_id, session_seg)))

    content_type = _safe_content_type(resp.headers.get("Content-Type"))
    if content_type:
        out_headers.append(("Content-Type", content_type))

    # Not a blind passthrough: body is forwarded (required for WHEP SDP/ICE
    # signalling to function), but only the Link/Location/Content-Type
    # headers above are reflected, each already allowlisted/validated.
    return Response(resp.content, status=resp.status_code, headers=out_headers)


@app.route("/whep/<peer_id>", methods=_WHEP_METHODS)
def whep_proxy(peer_id):
    if not _is_safe_segment(peer_id):
        abort(404)
    return _proxy_whep(f"{MEDIAMTX_URL}/{peer_id}/whep", peer_id)


@app.route("/whep/<peer_id>/<session>", methods=_WHEP_METHODS)
def whep_session_proxy(peer_id, session):
    if not _is_safe_segment(peer_id) or not _is_safe_segment(session):
        abort(404)
    return _proxy_whep(f"{MEDIAMTX_URL}/{peer_id}/whep/{session}", peer_id)


@app.route("/api/stream/ready/<peer_id>")
def api_stream_ready(peer_id):
    if not _is_safe_segment(peer_id):
        abort(404)
    url = f"{MEDIAMTX_URL}/{peer_id}/whep"
    try:
        # url is MEDIAMTX_URL (trusted config) + peer_id, already restricted
        # to _SAFE_SEGMENT_RE; only status_code is read, never forwarded.
        r = requests.options(url, timeout=5)  # nosemgrep: python.flask.security.injection.ssrf-requests.ssrf-requests
        return jsonify({"ready": r.status_code != 404, "status": r.status_code})
    except requests.RequestException:
        return jsonify({"ready": False, "status": 0})
