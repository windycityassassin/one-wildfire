"""The narrator: turn web/voice/lines.json into one MP3 per step of the story.

Two ways to fill web/voice/:

  1. An AI voice from ElevenLabs (a stand-in until the real recording):
        python 40_voice.py --list            # the voices on the account
        python 40_voice.py                   # generate every line that changed
        python 40_voice.py --only pixels     # just one line
     Needs ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID, either exported or in demo/.env (never committed).

  2. My own voice: record each line as web/voice/<step>.mp3 (same names as lines.json), then
        python 40_voice.py --own             # rebuild voice.json from the files, marked as a real recording

Output: web/voice/<step>.mp3 and web/voice/voice.json, which the page reads (no voice.json = no narration).
"""
import argparse
import base64
import re
import hashlib
import json
import os
import pathlib
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
VOICE = ROOT / "web/voice"
API = "https://api.elevenlabs.io/v1"
MODEL = "eleven_multilingual_v2"
SETTINGS = dict(stability=0.55, similarity_boost=0.75, style=0.0, use_speaker_boost=True)


def env(name):
    if os.environ.get(name):
        return os.environ[name]
    f = ROOT / ".env"
    if f.exists():
        for line in f.read_text().splitlines():
            k, _, v = line.partition("=")
            if k.strip() == name and v.strip():
                return v.strip().strip('"').strip("'")
    return None


def call(path, key, body=None):
    req = urllib.request.Request(f"{API}{path}", data=json.dumps(body).encode() if body else None,
                                 headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "*/*"},
                                 method="POST" if body else "GET")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        sys.exit(f"ElevenLabs {e.code} on {path}: {e.read().decode(errors='replace')[:400]}")


MARK = re.compile(r"\{(\w+)\}")


def lines():
    L = json.loads((VOICE / "lines.json").read_text())
    return {k: v for k, v in L.items() if not k.startswith("_")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true", help="list the voices on the account")
    ap.add_argument("--only", help="generate only this step")
    ap.add_argument("--force", action="store_true", help="re-generate every line, changed or not")
    ap.add_argument("--own", action="store_true", help="the MP3s are my own recordings: just rebuild voice.json")
    ap.add_argument("--web", default="web", help="which copy of the site to write to (default web/, e.g. web-v6)")
    a = ap.parse_args()
    global VOICE
    VOICE = ROOT / a.web / "voice"
    L = lines()
    old = json.loads((VOICE / "voice.json").read_text()) if (VOICE / "voice.json").exists() else {}

    if a.own:
        # marks can't be measured from a recording here: keep the ones from the AI clips as a first guess
        clips = {k: dict(file=f"{k}.mp3", text=MARK.sub("", t), **({"marks": old["clips"][k]["marks"]} if "marks" in old.get("clips", {}).get(k, {}) else {}))
                 for k, t in L.items() if (VOICE / f"{k}.mp3").exists()}
        missing = sorted(set(L) - set(clips))
        (VOICE / "voice.json").write_text(json.dumps(dict(synthetic=False, voice="my own voice", clips=clips), indent=1))
        print(f"voice.json: {len(clips)} recordings" + (f"; missing: {', '.join(missing)}" if missing else ""))
        return

    key = env("ELEVENLABS_API_KEY")
    if not key:
        sys.exit("No ELEVENLABS_API_KEY. Put it in demo/.env (see .env.example) or export it.")
    if a.list:
        for v in json.loads(call("/voices", key))["voices"]:
            lab = v.get("labels") or {}
            print(f"{v['voice_id']}  {v['name']:<22} {lab.get('gender', ''):<8} {lab.get('accent', ''):<12} {lab.get('description') or lab.get('descriptive', '')}")
        return
    voice_id = env("ELEVENLABS_VOICE_ID")
    if not voice_id:
        sys.exit("No ELEVENLABS_VOICE_ID. Pick one with --list and put it in demo/.env.")
    voices = {v["voice_id"]: v["name"] for v in json.loads(call("/voices", key))["voices"]}

    keys = list(L)
    clips = {k: c for k, c in (old.get("clips") or {}).items() if k in L} if old.get("synthetic", True) else {}
    for i, k in enumerate(keys):
        text = L[k]
        h = hashlib.sha1(f"{voice_id}|{MODEL}|{json.dumps(SETTINGS)}|{text}".encode()).hexdigest()[:12]
        if (a.only and k != a.only) or (not a.force and clips.get(k, {}).get("hash") == h and (VOICE / f"{k}.mp3").exists()):
            continue
        # a {mark} in the text (e.g. "{strike}lightning") is not spoken: it asks for the moment that word starts,
        # so the page can time a picture to it (voice.json: clips[k].marks)
        marks = [(m.group(1), m.start() - sum(len(x.group(0)) for x in MARK.finditer(text[:m.start()]))) for m in MARK.finditer(text)]
        spoken = MARK.sub("", text)
        body = dict(text=spoken, model_id=MODEL, voice_settings=SETTINGS,
                    # the lines either side, so each clip is read as part of one continuous telling
                    previous_text=MARK.sub("", L[keys[i - 1]]) if i else None, next_text=MARK.sub("", L[keys[i + 1]]) if i + 1 < len(keys) else None)
        body = {k2: v for k2, v in body.items() if v is not None}
        clips[k] = dict(file=f"{k}.mp3", text=spoken, hash=h)
        if marks:
            r = json.loads(call(f"/text-to-speech/{voice_id}/with-timestamps?output_format=mp3_44100_128", key, body))
            audio = base64.b64decode(r["audio_base64"])
            starts = r["alignment"]["character_start_times_seconds"]
            clips[k]["marks"] = {name: round(starts[min(at, len(starts) - 1)], 2) for name, at in marks}
        else:
            audio = call(f"/text-to-speech/{voice_id}?output_format=mp3_44100_128", key, body)
        (VOICE / f"{k}.mp3").write_bytes(audio)
        print(f"  {k}: {len(audio) / 1e3:.0f} kB" + (f", marks {clips[k]['marks']}" if marks else ""))
    (VOICE / "voice.json").write_text(json.dumps(dict(synthetic=True, voice=f"{voices.get(voice_id, voice_id)} (ElevenLabs, {MODEL})",
                                                      clips=clips), indent=1))
    print(f"voice.json: {len(clips)} of {len(L)} lines")


if __name__ == "__main__":
    main()
