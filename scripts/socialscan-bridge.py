#!/usr/bin/env python3
import asyncio
import inspect
import json
import sys


def emit(payload):
    sys.stdout.write(json.dumps(payload, separators=(",", ":")))


def fail(code):
    emit({"ok": False, "code": code})
    raise SystemExit(1)


def read_request():
    try:
        request = json.loads(sys.stdin.read())
    except Exception:
        fail("BRIDGE_INPUT_INVALID")
    if not isinstance(request, dict) or set(request) - {"action", "query", "platforms"}:
        fail("BRIDGE_INPUT_INVALID")
    action = request.get("action")
    platforms = request.get("platforms")
    if action not in {"preflight", "query"} or not isinstance(platforms, list) or not platforms:
        fail("BRIDGE_INPUT_INVALID")
    if any(not isinstance(value, str) or not value or not value.replace("_", "").replace("-", "").isalnum() for value in platforms):
        fail("BRIDGE_INPUT_INVALID")
    if action == "query" and (not isinstance(request.get("query"), str) or not request["query"].strip()):
        fail("BRIDGE_INPUT_INVALID")
    return request


def platform_lookup(platforms_type):
    candidates = {}
    members = getattr(platforms_type, "__members__", {})
    for name, member in members.items():
        candidates[name.lower().replace("_", "").replace("-", "")] = member
        value = getattr(member, "value", None)
        if isinstance(value, str):
            candidates[value.lower().replace("_", "").replace("-", "")] = member
    for name, member in getattr(platforms_type, "__dict__", {}).items():
        if name.startswith("_"):
            continue
        if isinstance(member, (str, int)):
            candidates[name.lower().replace("_", "").replace("-", "")] = member
    return candidates


def resolve_platforms(platforms_type, names):
    lookup = platform_lookup(platforms_type)
    resolved = []
    for name in names:
        item = lookup.get(name.lower().replace("_", "").replace("-", ""))
        if item is None:
            fail("PLATFORM_INVALID")
        resolved.append(item)
    return resolved


def flatten_results(value):
    if isinstance(value, dict):
        if any(key in value for key in ("found", "available", "exists", "valid")):
            return [value]
        output = []
        for item in value.values():
            output.extend(flatten_results(item))
        return output
    if isinstance(value, (list, tuple, set)):
        output = []
        for item in value:
            output.extend(flatten_results(item))
        return output
    return [value]


def is_match(item):
    if isinstance(item, bool):
        return item
    if isinstance(item, dict):
        if item.get("success") is False or item.get("valid") is False:
            return False
        for key in ("found", "available", "exists", "valid"):
            if isinstance(item.get(key), bool):
                return item[key] if key != "available" else not item[key]
        return False
    if getattr(item, "success", None) is False or getattr(item, "valid", None) is False:
        return False
    for key in ("found", "exists", "valid"):
        value = getattr(item, key, None)
        if isinstance(value, bool):
            return value
    available = getattr(item, "available", None)
    return not available if isinstance(available, bool) else False


async def main():
    request = read_request()
    try:
        from socialscan.util import Platforms, execute_queries
    except Exception:
        fail("BRIDGE_IMPORT_FAILURE")

    platforms = resolve_platforms(Platforms, request["platforms"])
    if request["action"] == "preflight":
        emit({"ok": True, "ready": True})
        return

    try:
        response = execute_queries([request["query"]], platforms)
        if inspect.isawaitable(response):
            response = await response
    except Exception:
        fail("BRIDGE_EXECUTION_FAILURE")

    results = flatten_results(response)
    checked = len(results)
    if checked == 0:
        checked = len(platforms)
    matches = sum(1 for item in results if is_match(item))
    emit({"ok": True, "checked": checked, "matches": min(matches, checked)})


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except SystemExit:
        raise
    except Exception:
        fail("BRIDGE_EXECUTION_FAILURE")
