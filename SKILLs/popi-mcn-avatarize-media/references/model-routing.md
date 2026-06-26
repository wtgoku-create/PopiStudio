# Model Routing

Use this reference when turning POPi MCN user media into virtual-character outputs.

## Image Route: Seedream

Use Seedream for direct image replacement:

```bash
bash "$SKILLS_ROOT/seedream/scripts/generate-image.sh" \
  --prompt "<replacement prompt>" \
  --image "<source image>" \
  --image "<optional character reference>" \
  --output "<final image path>"
```

Prompt pattern:

```text
Keep the original photo background, composition, camera angle, lighting, objects, and subject pose.
Replace <target subject> with <virtual character description/reference>.
Use the provided character reference as the identity source.
Do not change unrelated people, pets, props, text, or environment.
Output a finished shareable POPi MCN image.
```

For image batches, reuse the same character wording and reference image order across all calls.

## Video Route: Seedance

Use Seedance or another reference-guided video model for video replacement. Prefer feeding the source video plus character reference when the model supports it. If the local wrapper only supports image references, prepare the prompt and handoff notes explicitly rather than falling back to full frame-by-frame generation.

Prompt pattern:

```text
Use the source video as the motion, camera, scene, timing, and action reference.
Replace <target subject> with <virtual character description/reference>.
Keep the original background, camera movement, body motion, pet motion, scene rhythm, and overall vlog feeling.
Maintain the same virtual character identity throughout the full clip.
Avoid flicker, face drift, limb deformation, pet shape drift, and background melting.
Output a finished short video.
```

For short-form output, default to 9:16 only when the source or platform target allows it. Otherwise preserve the source aspect ratio.

## When to Use Frames

Use frames only for analysis, preview, QA, or targeted repair:

```bash
ffmpeg -i "<video>" -vf "fps=1" "<frames_dir>/frame_%05d.png"
```

Use scene-change extraction when the clip has many cuts:

```bash
ffmpeg -i "<video>" -vf "select='gt(scene,0.25)',showinfo" -vsync vfr "<frames_dir>/scene_%05d.png"
```

Do not present these commands as the main generation method.
