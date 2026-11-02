# 705 km to 1.6 m

One wildfire, seen by a satellite, by a drone, and by a person.

`web/index.html` is a single scrolling story about the 2015 Soda Fire on the Idaho–Oregon border:

1. **From space (705 km).** Aqua's first pass over the fire, the hot spots of five days, and the question
   "how many fires is this?". A re-run of the space-time grouping rule of Cattau et al. (2016) counts 38; with
   a little more room it counts one. The same test on 1,431 official US fires, 2020–2024: 57% counted
   correctly with the 2016 setting, 74% with more room.
2. **From a drone (44 m).** Seven years later, a research drone flies one corner of the burn. Its photos
   become a 3D block with the fire line on it. The drone sees height, so it finds 2 in 3 of the big shrubs
   but only about 8 in 100 of the young ones that are the recovery itself.
3. **From the ground (1.6 m).** A game: stand over a field circle, tap the young shrubs you can see, and
   compare your count with the drone's and the field crew's. On a phone or tablet with AR, it can be played in AR instead.

Every claim on the page is a link to its source. Two of them open full proof pages.

| Page | What it is |
|---|---|
| `web/index.html` | The story. |
| `web/methods.html` | How every number was made, and the limits. |
| `web/proof/national.html` | The 1,431-fire test: map, four fires up close, every region, every fire. |
| `web/explore.html` | An earlier explorer, kept for its *Fire stories*: 58 named fires, before / during / after. |

## Run it

```bash
cd demo
python3 serve.py            # web/ at http://127.0.0.1:8765, caching off
python3 serve.py 8767 web-v7   # another copy, on its own port
```

The site is static (MapLibre GL, three.js, d3 from CDNs; everything else in `web/`). To publish it, serve the
`web/` folder, for example with GitHub Pages.

## Narration

`web/voice/lines.json` holds the narrator's lines, one per step of the story plus the replies to each guess and
each circle of the game. `pipeline/40_voice.py` turns them into `web/voice/*.mp3` and `voice.json`, which the
page reads (no `voice.json`, no narration buttons).

```bash
cd pipeline
python 40_voice.py --list          # the voices on the ElevenLabs account
python 40_voice.py                 # regenerate every line whose text changed
python 40_voice.py --own           # your own recordings: rebuild voice.json from the MP3s
```

The ElevenLabs key and voice id go in `demo/.env` (never committed). The AI voice is a stand-in until the
author records the lines.

## Pipeline

Python 3.11, dependencies in `requirements.txt` (plus pyproj, scikit-learn, joblib for the national test).
Raw inputs live in `data/raw/` (NASA FIRMS yearly archives, WFIGS perimeters, the Soda Fire drone datasets).

```bash
cd pipeline
python 00_fetch_firms.py                  # NASA FIRMS MODIS C6.1 yearly archives
python 01_fetch_perimeters.py             # WFIGS perimeters with discovery time and origin
python 10_fetch_national_perimeters.py    # 2020-2024 CONUS perimeters
python 11_national_dataset.py             # labelled detections + candidate pairs
python 12_features.py; python 13_train_eval.py; python 15_review.py; python 16_summary.py
                                          # the leave-one-region-out test -> web/data/national.json
python 31_soda.py                         # Soda Fire detections, the 2016 rule vs more room, ERA5 wind
python 30_drone_scene.py                  # drone block, canopy model, field circles (needs data/raw/uas)
python 33_drone_tiles.py                  # the site in 20 m tiles at 1 cm, for close-ups and AR (after 30)
python 32_proof.py                        # the proof page's data; re-scores every fire and checks the totals
python 18_fire_stories.py; python 19_pixel_footprints.py; python 21_before_after.py
                                          # the Fire stories explorer
```

### The national test, in short

565,317 MODIS detections (2020–2024, contiguous US) were scored against 1,431 official wildfires (WFIGS
perimeters ≥ 100 acres) in six regions. Each region was held out in turn; every setting was chosen on the
other five. A fire counts as correct when one group holds ≥ 90% of its detections and ≥ 90% of that group is
that fire.

| Method | Fires counted correctly |
|---|---|
| 2016 setting (1.5 km, 4 days) | 57% |
| One wider window (4 km, 10–14 days) | 74% |
| Best window for each held-out region itself | 77% |

More room fixes 328 fires and breaks 78. Of the fires it still gets wrong, most are separate fires that
burned into each other, which look like one fire from space.

## Versions

Every change since the approved build is logged in `CHANGELOG.md`, with how to undo it. Snapshots live in
`versions/`; the changelog says which is which.

## How it was built

The author set the questions, chose the data and checked every number against the source files. An AI
coding assistant (Claude) wrote most of the code.

## Sources

- Cattau, M.E., Harrison, M.E., Shinyo, I., Tungau, S., Uriarte, M., DeFries, R. (2016). Sources of anthropogenic fire ignitions on the peat-swamp landscape in Kalimantan, Indonesia. *Global Environmental Change* 39: 205–219. https://doi.org/10.1016/j.gloenvcha.2016.05.005
- Mahood, A.L., Tuff, T., Cattau, M.E., et al. (2025). The properties of individual fire events are essential for understanding global fire regimes. *Global Ecology and Biogeography* 34(11): e70145. https://doi.org/10.1111/geb.70145
- Zaiats, A., Caughlin, T.T., Cruz, J., Pilliod, D.S., Cattau, M.E., et al. (2024). Propagating observation errors to enable scalable and rigorous enumeration of plant population abundance with aerial imagery. *Methods in Ecology and Evolution* 15(11): 2074–2086. https://doi.org/10.1111/2041-210X.14421
- Zaiats, A., Caughlin, T.T. (2023). Low-cost UAS platforms to quantify and predict post-fire recovery in arid shrublands [dataset]. https://doi.org/10.7923/96mc-a063 (CC BY 4.0)
- Marie, V., Zaiats, A., Roser, A., Olsoy, P., Delparte, D., Wickersham, R., Caughlin, T.T. (2023). Digital aerial imagery from the 2015-SODA wildfire boundary [dataset]. https://doi.org/10.7923/59M8-5S68 (CC BY 4.0)
- NASA FIRMS MODIS Collection 6.1; NIFC Interagency Fire Perimeter History and WFIGS Interagency Fire Perimeters; ERA5 (Hersbach et al. 2020) via Open-Meteo; Esri World Imagery; OpenStreetMap via OpenFreeMap.
