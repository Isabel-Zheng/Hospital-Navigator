from flask import Flask, request, jsonify, render_template
import json
from math import inf
from pathlib import Path
import os
from typing import Optional
from pydantic import BaseModel
from openai import OpenAI

app = Flask(__name__)
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

DATA_DIR = Path("data")
LOC_PATH = DATA_DIR / "locations.json"
EDGE_PATH = DATA_DIR / "edges.json"
FLOOR_PATH = DATA_DIR / "floors.json"

def load_json(path: Path, default):
    if not path.exists():
        return default
    with open(path, "r") as f:
        return json.load(f)

def save_json(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(obj, f, indent=2)

def load_locations_list():
    return load_json(LOC_PATH, [])

def load_locations_dict():
    locs = load_locations_list()
    return {x["id"]: x for x in locs}

def load_edges():
    return load_json(EDGE_PATH, [])

def load_edges_list():
    return load_json(EDGE_PATH, [])

def edges_equivalent(e1_from, e1_to, e2_from, e2_to):
    # treat edges as undirected duplicates
    return (e1_from == e2_from and e1_to == e2_to) or (e1_from == e2_to and e1_to == e2_from)

def save_edges_one_per_line(edges: list[dict]):
    EDGE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(EDGE_PATH, "w") as f:
        f.write("[\n")
        for i, e in enumerate(edges):
            line = json.dumps(e, separators=(",", ":"))
            if i < len(edges) - 1:
                line += ","
            f.write("  " + line + "\n")
        f.write("]\n")

def append_edge(new_edge: dict):
    edges = load_edges_list()
    for e in edges:
        if edges_equivalent(e["from"], e["to"], new_edge["from"], new_edge["to"]):
            raise ValueError(f"Duplicate edge: {new_edge['from']} <-> {new_edge['to']}")
    edges.append(new_edge)
    save_edges_one_per_line(edges)

def save_locations_one_per_line(locs: list[dict]):
    LOC_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOC_PATH, "w") as f:
        f.write("[\n")
        for i, loc in enumerate(locs):
            line = json.dumps(loc, separators=(",", ":"))
            if i < len(locs) - 1:
                line += ","
            f.write("  " + line + "\n")
        f.write("]\n")

def append_location(new_loc: dict):
    locs = load_locations_list()
    if any(l["id"] == new_loc["id"] for l in locs):
        raise ValueError(f"Duplicate id: {new_loc['id']}")
    locs.append(new_loc)
    save_locations_one_per_line(locs)

def load_floors():
    return load_json(FLOOR_PATH, [
  {"floor":1,"image":"Floor1.png"},
  {"floor":2,"image":"Floor2.png"},
  {"floor":3,"image":"Floor3.png"},
  {"floor":4,"image":"Floor4.png"}
])

def floor_to_image():
    return {int(f["floor"]): f["image"] for f in load_floors()}

def build_graph(edges):
    g = {}
    for e in edges:
        a, b = e["from"], e["to"]
        d = float(e["distance"])
        note = e.get("note", "")
        g.setdefault(a, []).append((b, d, note))
        g.setdefault(b, []).append((a, d, note))  # undirected
    return g

def dijkstra(graph, start, goal):
    dist = {start: 0.0}
    prev = {}
    prev_note = {}
    visited = set()

    while True:
        cur = None
        curd = inf
        for node, d in dist.items():
            if node not in visited and d < curd:
                cur, curd = node, d

        if cur is None:
            return None  # unreachable
        if cur == goal:
            break

        visited.add(cur)
        for nxt, w, note in graph.get(cur, []):
            nd = curd + w
            if nd < dist.get(nxt, inf):
                dist[nxt] = nd
                prev[nxt] = cur
                prev_note[nxt] = note

    # reconstruct path
    path = [goal]
    while path[-1] != start:
        path.append(prev[path[-1]])
    path.reverse()
    return path, dist[goal], prev_note

class SmartSearchResult(BaseModel):
    destination_id: Optional[str]
    confidence: float
    clarification_needed: bool
    clarification_question: Optional[str]

def is_searchable_location(loc):
    return loc.get("searchable") is True

def smart_search_location(query: str):
    locations = load_locations_list()

    searchable_locations = [
        loc for loc in locations
        if is_searchable_location(loc)
    ]

    location_text = "\n".join(
        f"- id={loc['id']} | "
        f"name={loc['name']} | "
        f"floor={loc.get('floor')} | "
        f"tags={', '.join(loc.get('tags', []))}"
        for loc in searchable_locations
    )

    system_prompt = f"""
You are the natural-language search system for a hospital navigation app.

Your job is to determine which destination the user is trying to find.

You MUST only select destination_id values from the provided hospital locations.
Never invent a location.
Never invent a destination ID.

If the request is ambiguous between multiple destinations,
set destination_id to null and clarification_needed to true,
then ask a short clarification question.

Do not diagnose medical conditions.
Do not infer what medical treatment a patient needs.
Only interpret requests for locations, departments, services, amenities,
or known hospital destinations.

Hospital locations:

{location_text}
"""

    response = client.responses.parse(
        model="gpt-5.6",
        input=[
            {
                "role": "system",
                "content": system_prompt
            },
            {
                "role": "user",
                "content": query
            }
        ],
        text_format=SmartSearchResult
    )

    result = response.output_parsed

    # Extra safety check:
    valid_ids = {loc["id"] for loc in searchable_locations}

    if result.destination_id is not None and result.destination_id not in valid_ids:
        result.destination_id = None
        result.confidence = 0
        result.clarification_needed = True
        result.clarification_question = (
            "I couldn't confidently match that to a hospital destination. "
            "Could you describe what you're looking for another way?"
        )

    return result

@app.get("/")
def home():
    return render_template("index.html")

@app.get("/api/locations")
def api_locations():
    locations = load_locations_list()
    out = [
        {"id": loc["id"], "name": loc["name"], "tags": loc.get("tags", [])}
        for loc in locations
        if loc.get("searchable") is True
    ]
    return jsonify(out)

@app.post("/api/route")
def api_route():
    body = request.get_json()
    start = body.get("start", "front_desk")
    goal = body["goal"]

    locations = load_locations_dict()
    edges = load_edges()
    graph = build_graph(edges)

    if start not in locations or goal not in locations:
        return jsonify({"error": "Unknown start/goal id"}), 400

    res = dijkstra(graph, start, goal)
    if res is None:
        return jsonify({"error": "No route found"}), 404

    path, total_dist, prev_note = res

    steps = []
    for i in range(len(path) - 1):
        nxt = path[i+1]
        note = prev_note.get(nxt, "").strip()
        if note:
            steps.append(note)
        else:
            steps.append(f"Go to {locations[nxt]['name']}")

    # Return path node coords (normalized 0..1)
    path_nodes = [locations[nid] for nid in path]
    dest_floor = int(locations[goal]["floor"])
    floor_img = floor_to_image().get(dest_floor)

    return jsonify({
    "path": path,
    "totalDistance": total_dist,
    "steps": steps,
    "pathNodes": path_nodes,
    "destFloor": dest_floor,
    "floorImage": floor_img,
    "floorImages": floor_to_image()
    })

@app.get("/capture")
def capture():
    floors = load_floors()
    return render_template("capture.html", floors=floors)

@app.get("/api/floors")
def api_floors():
    return jsonify(load_floors())

@app.post("/api/add_location")
def api_add_location():
    """
    Body:
    {
      "id": "f1_jct_west",
      "name": "West Junction",
      "floor": 1,
      "x": 0.123456,
      "y": 0.654321,
      "tags": ["xray", "radiology"]
    }
    """
    loc = request.get_json(force=True)

    # required fields
    for k in ["id", "name", "floor", "x", "y"]:
        if k not in loc:
            return jsonify({"error": f"Missing field: {k}"}), 400

    # normalize / validate
    loc["id"] = str(loc["id"]).strip()
    loc["name"] = str(loc["name"]).strip()
    loc["floor"] = int(loc["floor"])
    loc["x"] = float(loc["x"])
    loc["y"] = float(loc["y"])
    loc["tags"] = [t.strip() for t in loc.get("tags", []) if t.strip()]

    if not loc["id"]:
        return jsonify({"error": "id cannot be empty"}), 400
    if not (0.0 <= loc["x"] <= 1.0 and 0.0 <= loc["y"] <= 1.0):
        return jsonify({"error": "x/y must be normalized between 0 and 1"}), 400

    try:
        append_location(loc)
    except ValueError as e:
        return jsonify({"error": str(e)}), 409

    return jsonify({"ok": True, "added": loc})

@app.get("/capture_edges")
def capture_edges():
    floors = load_floors()
    return render_template("capture_edges.html", floors=floors)

@app.get("/api/nodes_by_floor")
def api_nodes_by_floor():
    floor = int(request.args.get("floor", 1))
    locs = load_locations_list()
    nodes = [l for l in locs if int(l.get("floor", 1)) == floor]
    # return minimal fields used by the UI
    out = [{"id": n["id"], "name": n["name"], "floor": n["floor"], "x": n["x"], "y": n["y"]} for n in nodes]
    return jsonify(out)

@app.get("/api/edges_by_floor")
def api_edges_by_floor():
    floor = int(request.args.get("floor", 1))
    locs = load_locations_dict()
    edges = load_edges()

    floor_nodes = {nid for nid, n in locs.items() if int(n.get("floor", 1)) == floor}

    # only edges where BOTH endpoints are on this floor
    out = [e for e in edges if e["from"] in floor_nodes and e["to"] in floor_nodes]
    return jsonify(out)

@app.post("/api/add_edge")
def api_add_edge():
    """
    Body:
    {
      "from": "f1_jct_south",
      "to": "f1_courtyard",
      "distance": 20,
      "note": "optional",
      "accessible": true
    }
    """
    e = request.get_json(force=True)

    for k in ["from", "to", "distance"]:
        if k not in e:
            return jsonify({"error": f"Missing field: {k}"}), 400

    e_from = str(e["from"]).strip()
    e_to = str(e["to"]).strip()
    if not e_from or not e_to or e_from == e_to:
        return jsonify({"error": "Edge endpoints must be two different node ids"}), 400

    # validate nodes exist
    locs = load_locations_dict()
    if e_from not in locs or e_to not in locs:
        return jsonify({"error": "Unknown node id in from/to"}), 400

    # relative weights: any positive number is fine
    dist = int(float(e["distance"]))
    if dist <= 0:
        return jsonify({"error": "distance must be > 0"}), 400

    new_edge = {
        "from": e_from,
        "to": e_to,
        "distance": dist,
        "note": str(e.get("note", "")).strip(),
        "accessible": bool(e.get("accessible", True))
    }

    try:
        append_edge(new_edge)
    except ValueError as ex:
        return jsonify({"error": str(ex)}), 409

    return jsonify({"ok": True, "added": new_edge})

@app.post("/api/smart-search")
def api_smart_search():
    body = request.get_json(force=True)

    query = str(body.get("query", "")).strip()

    if not query:
        return jsonify({"error": "Search query cannot be empty"}), 400

    try:
        result = smart_search_location(query)
    except Exception as e:
        print("Smart search error:", e)

        return jsonify({"error": "Smart search is temporarily unavailable"}), 500

    return jsonify(result.model_dump())

if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
