# Local Runtime Notes

Keep these runtime files because they are part of the actual workflow:
- `scripts/run.py`
- `scripts/video.py`
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

### Step 2: Batch Video Generation

`scripts/video.py`:
- loads Step 1 results from `img_results.json`
- uploads each confirmed local image with `popiart media upload <path> --visibility public`
- stores the returned stable media URL as `confirmed_media_url`
- generates all selected clips in one batch
- defaults img2video duration to 3 seconds unless the user explicitly specifies another duration
- uses the same retry and bounded polling strategy
- writes `video_results.json`
- concatenates clips automatically after all selected videos succeed
- generates `video_preview.html` only after clip generation, retries, and final concatenation finish

## Execution Rules

- retry policy: primary model 2 attempts, fallback model 2 attempts, then stop and report likely provider-side failure
- polling policy: fixed interval, image timeout 120 seconds, video timeout 300 seconds, no silent infinite polling
- display policy: one image phase, one confirmed-image upload phase, one video phase, one final concatenation phase
