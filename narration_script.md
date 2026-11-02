# The narrator

The spoken lines live in **`web/voice/lines.json`**: one line per screen, plus `drone-answer`, which plays once you guess. Edit them there. That file is the only copy.

## For now: an AI voice from ElevenLabs

1. Copy `.env.example` to `.env` (in `demo/`), and paste the API key after `ELEVENLABS_API_KEY=`. `.env` is never committed.
2. See the voices on the account and pick one:
   ```bash
   cd demo/pipeline && ../.venv/bin/python 40_voice.py --list
   ```
   Put its ID after `ELEVENLABS_VOICE_ID=` in `.env`.
3. Generate the clips:
   ```bash
   ../.venv/bin/python 40_voice.py
   ```
   Only lines that changed are re-generated. Use `--only pixels` for one line, or `--force` for all.

The page then shows **Begin with narration**, plus a small note: "Narrated by an AI voice for now, standing in for mine." With no clips, the page has no narration and no note.

## Later: my own voice

1. Record each line from `lines.json` as `web/voice/<name>.mp3`: `intro.mp3`, `pixels.mp3`, and so on. Use the same names as in the file.
2. Run:
   ```bash
   ../.venv/bin/python 40_voice.py --own
   ```
   The "AI voice" note disappears.

Recording tips: a quiet room, the phone about 20 cm away, one line per take. Leave half a second of silence at each end.

## Timing a picture to a word

Put `{name}` just before a word in `lines.json` (for example `{strike}lightning`). It is not spoken; `40_voice.py` asks ElevenLabs for word timings and stores the moment in `voice.json`, and the page waits for it (the bolt in `start`, the map change in `national`). With your own recordings, the AI timings are kept as a first guess; adjust `marks` in `voice.json` by hand if your pacing differs.
