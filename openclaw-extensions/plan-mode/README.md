# Popi Plan Mode

OpenClaw-native read-only planning mode inspired by the Pi plan-mode extension.

## Commands

- `/plan` enters planning mode.
- `/plan status` reports the current mode.
- `/plan approve` switches to execution mode after `plan_mode_complete` submits a plan.
- `/plan off` exits planning mode and restores normal tool access.

The agent first displays the plan through the normal assistant text stream,
then calls `plan_mode_complete` with the same Markdown as the authoritative
submission. The Popi UI controls the same state through the `popi.plan.control` Gateway RPC
(`start`, `approve`, `cancel`, and `status`). Approval includes the current
plan hash and revision, so a stale plan cannot unlock write tools.

Planning mode allows repository inspection and blocks write-oriented tools. The
state is persisted per OpenClaw session under the OpenClaw state directory, so
the gateway can restart without losing the active mode or submitted plan.

The mode rules are added to every model request through OpenClaw's
`before_prompt_build` hook as `prependSystemContext`. The application enables
the plugin's `hooks.allowPromptInjection` setting so the runtime accepts this
system-prompt contribution. The plugin also keeps tool-level guards for hard
read-only enforcement instead of relying on prompt instructions alone.
