# Local Runtime Notes

Keep these runtime files because they are part of the actual workflow:
- `scripts/run.py`
- `config/scenes.json`

## Runtime Summary

### Step 1: Batch Image Generation

`scripts/run.py`:
- accepts a local image path or a public image URL
- also supports the default character `爱丽丝 / Alice`
- shows the available scene list before asking for scene IDs
- displays aligned IDs such as `[01]`, `[04]`, `[06]`
- supports existing scene IDs, scene-list replay, and custom-scene requests
- supports per-scene outfit prompts while still running one batch image round
- writes `img_results.json`
- generates `preview.html` only after the whole image round and retries finish

## Execution Rules

- retry policy: primary model 2 attempts, fallback model 2 attempts, then stop and report likely provider-side failure
- polling policy: fixed interval, image timeout 120 seconds, no silent infinite polling
- display policy: one image phase followed by one image HTML preview phase
