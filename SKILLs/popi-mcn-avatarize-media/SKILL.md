---
name: popi-mcn-avatarize-media
description: Use for POPi MCN daily photo, vlog, short-video, pet-video, or user-generated media tasks where real people or pets should be replaced with anime, cartoon, 3D, VTuber, mascot, plush, or other virtual characters. Supports image and video deliverables, optional fixed character reference images, and workflows that route image edits to Seedream and reference-guided video replacement to Seedance.
---

# POPi MCN Avatarize Media

Use this skill as the POPi MCN business workflow for turning user-shot daily photos or videos into virtual-character media. Preserve the original scene, camera feel, posture, action, rhythm, and shareable vlog texture while replacing selected real people or pets with a virtual identity.

## Required Dependencies

Use the installed POPiStudio skills when producing assets:

- Seedream: use for image editing, image-to-image replacement, multi-image fusion, and character-reference image outputs.
- Seedance: use for reference-guided video generation or video editing with an original video plus character reference or character description.

If either dependency is unavailable, explain what is missing and continue with a best-effort brief, prompt pack, or manual handoff plan.

## Agent Integration

When used by a POPi MCN agent, treat this skill as the production SOP. The agent owns user interaction, clarification, and delivery tone. This skill owns media routing, prompt construction, model choice, and QA rules.

## POPi Agent Boundary

- Xiao Mo handles upstream concept and script guidance.
- Acong handles content review, blind prediction, scoring, and rubric evolution.
- Jianjishi handles editing, captions, packaging, and rendered short-form workflows.
- Xiao Huan handles only avatarized image/video subject replacement and final media delivery.

## Intake

Identify the requested deliverable before production:

- Source type: image, image batch, video, or mixed media.
- Replacement target: person, pet, multiple people, multiple pets, or all foreground subjects.
- Character source: uploaded character reference image, existing POPi virtual persona, or text-only character description.
- Output target: final image files or final video files. Keep the user-facing process simple.
- Platform defaults: use 9:16 for short-form video unless the source or user request implies another ratio.

Ask only for missing information that blocks production. If the user gives a source asset and a character reference, proceed.

## Routing

Choose the route by media type:

- Image: perform direct subject replacement with Seedream image editing. Do not create a frame pipeline for still images.
- Video: prefer Seedance or an equivalent reference-guided video model that accepts the original video and character reference or description. Do not default to frame-by-frame generation.
- Mixed media: process images through Seedream and videos through Seedance, keeping the character identity consistent across all outputs.

Read `references/model-routing.md` before writing production prompts or commands.

## Production Workflow

1. Inspect assets enough to understand subjects, scene, angle, lighting, motion, and any obvious rights or privacy issue.
2. Decide who or what changes. Preserve background, camera perspective, activity, objects, mood, and timing unless the user asks otherwise.
3. Build a concise production prompt:
   - State the exact subject replacement.
   - State the fixed character reference priority when provided.
   - State what must remain unchanged.
   - State style constraints: anime, cartoon, 3D, mascot, plush, VTuber, game character, or user-specified style.
4. Generate the image or video with the routed model.
5. Check the output against `references/quality-checklist.md`.
6. If the output fails, do targeted regeneration or rewrite the prompt around the failed moment, subject, or constraint. Keep reruns scoped.
7. Deliver only the final image or video unless the user asks for the process.

## Character Reference Rules

- Treat user-provided character reference images as the highest-priority identity source.
- Preserve distinctive character traits: hair shape/color, outfit silhouette, accessories, pet pattern, body type, mascot proportions, and color palette.
- When no reference image is provided, create a stable virtual identity from the user's description and reuse the same wording across all assets.
- Prefer consistency over single-frame beauty for video.
- Avoid turning a private real person into a recognizable public figure or living celebrity lookalike.

## Privacy and Rights

Use virtualized, non-realistic output for children, bystanders, or unclear third-party identities. If a person appears incidentally and is not the intended subject, avoid preserving a recognizable face. For pets, preserve species, body size, color impression, and behavior while allowing stylized simplification.

## Video Notes

Frame extraction is an analysis and QA tool, not the default generation route. Use extracted frames only to:

- Understand the original subject and action before prompt writing.
- Choose representative preview moments.
- Spot-check generated video for identity drift, flicker, broken limbs, pet deformation, or background damage.
- Locate a failed timestamp for targeted rerun.

Do not expose frame extraction to the end user unless it explains a production limitation or revision request.
