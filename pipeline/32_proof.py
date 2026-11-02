"""Proof for "Was that luck?": every fire in the national test, and three more fires like the Soda Fire.

Re-scores the 1,431 official fires of the national test (13_train_eval.py) with the 2016 rule (1.5 km, 4 days)
and with the wider window each region was given in that test (chosen on the other five regions), then checks
that the totals match web/data/national.json exactly. For three large fires in three states, it keeps every
hot spot with its 2016-rule piece and its wider-window piece, so the page can draw them.

  * fires: NIFC WFIGS Interagency Fire Perimeters, 2020-2024, >= 3 detections (as in the national test)
  * state: the state that holds the fire's median hot spot (US state outlines, PublicaMundi us-states.json,
    https://github.com/PublicaMundi/MappingAPI, saved to data/raw/ref/)

Outputs: web/data/proof/national.json (table, map, example fires), web/data/proof/us-states.json (map outlines)
"""
import json
import pathlib

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from shapely import contains_xy
from shapely.geometry import mapping, shape

ROOT = pathlib.Path(__file__).resolve().parents[1]
NAT, RAW, OUT = ROOT / "data/national", ROOT / "data/raw", ROOT / "web/data/proof"
YEARS = range(2020, 2025)
DEFAULT = (1.5, 4.0)
# the fires on the front page, in the order they appear (Soda is the fourth, from 31_soda.py)
EXAMPLES = ["2020-CASNF-001391", "2020-UTASF-100340", "2024-IDBOD-000917"]


def components(n, i, j):
    g = coo_matrix((np.ones(len(i), np.int8), (i, j)), shape=(n, n))
    return connected_components(g, directed=False)[1]


def ranked(lab):
    """Pieces numbered by size, biggest first, so colours follow the same order as on the Soda map."""
    v, c = np.unique(lab, return_counts=True)
    rank = {a: k for k, a in enumerate(v[np.argsort(-c, kind="stable")])}
    return np.array([rank[a] for a in lab])


def state_outlines():
    """The lower 48 states, simplified, for the proof page's map (the page itself fixes any ring d3 reads inside out)."""
    def rnd(c):
        return [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 3), round(c[1], 3)]
    feats = []
    for f in json.loads((RAW / "ref/us-states.json").read_text())["features"]:
        if f["properties"]["name"] in ("Alaska", "Hawaii", "Puerto Rico"):
            continue
        g = mapping(shape(f["geometry"]).simplify(0.03, preserve_topology=True))
        feats.append(dict(type="Feature", properties=dict(name=f["properties"]["name"]),
                          geometry=dict(type=g["type"], coordinates=rnd(g["coordinates"]))))
    (OUT / "us-states.json").write_text(json.dumps(dict(type="FeatureCollection", features=feats), separators=(",", ":")))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    state_outlines()
    nat = json.loads((ROOT / "web/data/national.json").read_text())
    perims = json.loads((NAT / "perimeters.json").read_text())
    tuned = {k: tuple(r["fixed_tuned_setting"]) for k, r in enumerate(nat["regions"])}
    states = [(f["properties"]["name"], shape(f["geometry"]))
              for f in json.loads((RAW / "ref/us-states.json").read_text())["features"]]
    uid_to_f = {p["uid"]: k for k, p in enumerate(perims)}
    want = {uid_to_f[u] for u in EXAMPLES}

    rows, examples = [], {}
    for y in YEARS:
        D, P = dict(np.load(NAT / f"dets_{y}.npz")), dict(np.load(NAT / f"pairs_{y}.npz"))
        reg = D["region"]
        ri, rj = reg[P["i"]], reg[P["j"]]
        for r in range(len(nat["regions"])):
            idx = np.flatnonzero(reg == r)
            if not len(idx):
                continue
            remap = np.full(len(reg), -1)
            remap[idx] = np.arange(len(idx))
            m = (ri == r) & (rj == r)
            i, j, d, dt = remap[P["i"][m]], remap[P["j"][m]], P["d"][m], P["dt"][m]
            tr = D["truth"][idx]
            if not (tr >= 0).any():
                continue
            scored = tr != -2
            labs = {}
            for name, (dd, tt) in (("rule", DEFAULT), ("wide", tuned[r])):
                k = (d <= dd) & (dt <= tt)
                labs[name] = components(len(idx), i[k], j[k])
            size = {n: np.bincount(l[scored], minlength=l.max() + 1) for n, l in labs.items()}
            lon, lat, t = D["lon"][idx], D["lat"][idx], D["t"][idx]
            for f in np.unique(tr[tr >= 0]):
                mine = np.flatnonzero(tr == f)
                if len(mine) < 3:
                    continue
                res = {}
                for n, l in labs.items():
                    ev, cnt = np.unique(l[mine], return_counts=True)
                    top = np.argmax(cnt)
                    ok = cnt[top] / len(mine) >= 0.9 and cnt[top] / size[n][ev[top]] >= 0.9
                    res[n] = (len(ev), bool(ok), round(float(cnt[top] / len(mine)), 3))
                p = perims[f]
                mx, my = float(np.median(lon[mine])), float(np.median(lat[mine]))
                st = next((s for s, g in states if contains_xy(g, mx, my)), "")
                rows.append(dict(name=p["name"] or "(unnamed)", uid=p["uid"], year=y, region=r, state=st,
                                 acres=round(p["acres"] or 0), n=len(mine), lon=round(mx, 3), lat=round(my, 3),
                                 p16=res["rule"][0], ok16=res["rule"][1], pw=res["wide"][0], okw=res["wide"][1],
                                 top16=res["rule"][2], topw=res["wide"][2]))
                if f in want:
                    t0 = t[mine].min()
                    examples[p["uid"]] = dict(
                        name=p["name"], uid=p["uid"], year=y, state=st, acres=round(p["acres"]), n=len(mine),
                        setting=list(tuned[r]), p16=res["rule"][0], pw=res["wide"][0],
                        # lon, lat, hours since first detection, 2016-rule piece, wider-window piece
                        dets=[[round(float(a), 4), round(float(b), 4), round(float((c - t0) * 24), 1), int(e), int(g)]
                              for a, b, c, e, g in zip(lon[mine], lat[mine], t[mine],
                                                       ranked(labs["rule"][mine]), ranked(labs["wide"][mine]))])
        print(f"{y}: {len(rows)} fires so far")

    # the totals must match the national test exactly, or this page is not proof of anything
    n = len(rows)
    r16, rw = np.mean([r["ok16"] for r in rows]), np.mean([r["okw"] for r in rows])
    print(f"{n} fires; 2016 rule {r16:.4f} (published {nat['overall']['default']}); "
          f"wider {rw:.4f} (published {nat['overall']['fixed_tuned']})")
    assert n == nat["n_scored_fires"], n
    assert abs(r16 - nat["overall"]["default"]) < 1e-4 and abs(rw - nat["overall"]["fixed_tuned"]) < 1e-4

    # perimeters of the example fires
    for u, ex in examples.items():
        for f in json.loads((RAW / f"perims_conus_{ex['year']}.geojson").read_text())["features"]:
            if f["properties"]["attr_UniqueFireIdentifier"] == u:
                ex["perimeter"] = mapping(shape(f["geometry"]).simplify(0.002, preserve_topology=True))
                break

    soda = json.loads((ROOT / "web/data/soda/soda.json").read_text())
    out = dict(
        regions=nat["regions"], overall=nat["overall"], n_detections=nat["n_detections"], n_fires=n,
        default=list(DEFAULT),
        examples=[examples[u] for u in EXAMPLES],
        soda=dict(name="Soda", year=2015, state="Idaho", acres=soda["fire"]["acres"], n=len(soda["dets"]),
                  p16=soda["events"]["rule2016"], pw=soda["events"]["wide"], setting=soda["events"]["wide_dt"]),
        cols=["name", "uid", "year", "region", "state", "acres", "n", "lon", "lat", "p16", "ok16", "pw", "okw", "top16", "topw"],
        fires=[[r[c] for c in ["name", "uid", "year", "region", "state", "acres", "n", "lon", "lat", "p16", "ok16", "pw", "okw", "top16", "topw"]]
               for r in sorted(rows, key=lambda r: -r["n"])],
    )
    (OUT / "national.json").write_text(json.dumps(out, separators=(",", ":")))
    for ex in out["examples"]:
        print(f"  {ex['name']} ({ex['state']} {ex['year']}): {ex['n']} hot spots, 2016 rule {ex['p16']} pieces, "
              f"wider {ex['setting']} {ex['pw']}")
    print("wrote", OUT / "national.json", f"{(OUT / 'national.json').stat().st_size / 1e3:.0f} kB")


if __name__ == "__main__":
    main()
