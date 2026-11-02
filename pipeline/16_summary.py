"""Combine the national leave-one-region-out results into web/data/national.json for the app."""
import json
import pathlib

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
WEB, NAT = ROOT / "web/data", ROOT / "data/national"
L = json.loads((WEB / "learned.json").read_text())
R = json.loads((WEB / "review.json").read_text())
G = json.loads((NAT / "growth_rows.json").read_text())
PARAMS = list(G["0"].keys())


def rec(rows):
    return float(np.mean([r[1] for r in rows])) if rows else None


regions = []
all_growth = []
for r, row in enumerate(L["regions"]):
    others = [q for q in G if q != str(r)]
    best = max(PARAMS, key=lambda p: rec([x for q in others for x in G[q][p]]))
    g = G[str(r)][best]
    all_growth += g
    regions.append(dict(
        region=row["region"], n_fires=row["learned"]["n_fires"],
        default=row["default"]["recovered"], fixed_tuned=row["fixed_tuned"]["recovered"],
        fixed_tuned_setting=[row["fixed_tuned"]["d"], row["fixed_tuned"]["T"]],
        oracle=row["fixed_oracle"]["recovered"], oracle_setting=[row["fixed_oracle"]["d"], row["fixed_oracle"]["T"]],
        learned=row["learned"]["recovered"], growth=round(rec(g), 4)))
o = L["overall"]
out = dict(
    years=L["years"], n_detections=L["n_detections"], n_pairs=L["n_pairs"], n_train_fires=L["n_fires"],
    n_scored_fires=o["learned"]["n_fires"], regions=regions,
    overall=dict(default=o["default"]["recovered"], fixed_tuned=o["fixed_tuned"]["recovered"],
                 oracle=o["fixed_oracle"]["recovered"], learned=o["learned"]["recovered"],
                 growth=round(rec(all_growth), 4),
                 ign_err_km=dict(default=o["default"]["ign_err_km"], fixed_tuned=o["fixed_tuned"]["ign_err_km"])),
    importance=L["importance"], review=R)
(WEB / "national.json").write_text(json.dumps(out, indent=1))
print(json.dumps(out["overall"]), [(r["region"], r["growth"]) for r in regions])
