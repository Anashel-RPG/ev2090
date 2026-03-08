# Personalized Voice Lines

This folder is a placeholder. Personalized audio is NOT stored in the repo.

## How It Works

Line #16 of the Solace Distress mission — "Captain Torres here. I won't forget this, {{nickname}}" —
is generated at runtime via the ElevenLabs TTS API.

- **Voice:** Brian (Deep, Resonant) — `nPczCjzI2devNBz1zQrb`
- **Template:** "Captain Torres here. I won't forget this, {{nickname}}."
- **Generated:** First time a player reaches Phase 5 (RESCUED) of the mission
- **Cached:** R2 at `voice/missions/solace-distress/personalized/{playerId}/16-wont-forget.mp3`
- **Invalidated:** When player changes nickname (delete + regenerate on next play)

## Fallback

If ElevenLabs API is unavailable:
1. Text still displays in the comms transcript (existing behavior)
2. No audio plays for this line
3. All other lines (pre-recorded) still play normally
