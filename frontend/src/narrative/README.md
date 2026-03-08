# narrative/ — Voice Line Assets

Pre-recorded audio files for voice-acted game content.
Files here are uploaded to R2 (`voice/`) and served via CDN.

## Folder Structure

```
narrative/
  solace-distress/              # Tutorial rescue mission (account-locked)
    meridian/                   # MERIDIAN (ship AI) lines — recorded with custom voice
      01-sensors-warmup.mp3
      02-scanner-online.mp3
      03-distress-detected.mp3
      06-source-locked.mp3
      12-crew-transfer.mp3
      15-pods-recovered.mp3
      18-mission-complete.mp3
    torres/                     # Captain Torres lines — recorded or ElevenLabs Brian
      04-hull-breach-static.mp3
      05-this-is-solace.mp3
      07-read-you-on-scanner.mp3
      08-hauling-medical.mp3
      09-twenty-minutes.mp3
      10-beautiful-fool.mp3
      11-standing-by.mp3
      13-escape-pods.mp3
      14-all-clear.mp3
      17-drinks-on-us.mp3
    personalized/               # TTS-generated per player (NOT stored here — R2 only)
      README.md                 # Explains that line #16 is generated at runtime

  meridian-ai/                  # MERIDIAN ship AI ambient lines
    dock-generic.mp3            # "Docking sequence initiated."
    undock-generic.mp3          # "Departure clearance granted."
    scanner-online.mp3          # "Scanner online. Sweep initiated."
    guest-prompt.mp3            # "Register to unlock full MERIDIAN capabilities."
    systems-nominal.mp3         # "MERIDIAN online. Systems nominal."
    cargo-full.mp3              # "Cargo hold at capacity."
    distress-nearby.mp3         # "Detecting distress beacon."
```

## Recording Guidelines

### MERIDIAN (Ship AI)
- Calm, precise, slight warmth
- Ship computer tone — not robotic, not emotional
- Consistent pacing: ~150 words/minute
- Clean recording, no effects (post-processing added in-engine)

### Captain Torres
- Gruff, exhausted, blue-collar
- Desperate but composed — not panicking
- Lines 04-05: heavy radio static effect (add in post)
- Lines 07-09: clearer signal, still stressed
- Line 10: relief breaking through exhaustion
- Lines 13-14: professional, focused on the job
- Line 17: warm, genuine gratitude

## Upload to R2

After recording, upload to R2 via:
```bash
# Upload entire mission
wrangler r2 object put ev2090-data/voice/missions/solace-distress/meridian/01-sensors-warmup.mp3 --file narrative/solace-distress/meridian/01-sensors-warmup.mp3

# Or use the bulk upload script (future)
npm run upload:voice
```

## Personalized Line (#16)

Line 16 — "Captain Torres here. I won't forget this, {{nickname}}." — is NOT pre-recorded.
It is generated at runtime via ElevenLabs TTS API using the Brian voice.
The generated audio is cached in R2 at:
```
voice/missions/solace-distress/personalized/{playerId}/16-wont-forget.mp3
```
