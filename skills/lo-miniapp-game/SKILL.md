---
name: lo-miniapp-game
description: Build or review a web game running as an LO Mini App, including native lifecycle, pause and exit, safe areas, audio and input, and portable public SDK integration. Use for LO game behavior or mobile integration; not for unrelated websites or backend-only tasks.
---

# LO Mini App game integration

Inspect the game's state machine, SDK bridge and actual target host before
changing behavior. Keep renderer and game-rule choices with the application.
Use the public SDK and the application's own authenticated backend.

For implementation examples and release scenarios, read the
[game integration guide](https://github.com/LO-ink/lo-miniapp-sdk/blob/main/docs/games.md).
When working in the SDK repository, use `docs/games.md` from that checkout.

## Decisions that prevent lifecycle bugs

1. Separate host activity, document visibility, player pause and saved audio
   preference. Subscribe to public `deactivated` and browser hidden/blur.
   `activated` and focus reset the frame clock; they do not resume a run.
2. For host-owned exit, keep SDK Back hidden and confirmation enabled throughout
   an unfinished run, including pause. Do not synthesize Escape from native Back
   or toggle pause on repeated Back. Internal Back navigation requires its own
   explicit policy.
3. Pause simulation, clear pending input and pointer capture, stop audio
   scheduling, and gate every gesture/autostart/settings resume path. Recheck
   activity after asynchronous AudioContext resume. Continue must be explicit
   and must not also trigger gameplay.
4. Reset frame timestamps and fixed-step accumulation on return. Guard all input
   paths, including canvas and test bots. Preserve replay time independently of
   time spent interrupted.
5. Fence native-presentation callbacks by current document/session ownership.
   Failed asynchronous navigation must release its own activity owner; old
   callbacks must not affect replacement screens. Successful exit must not emit
   an intermediate activation.

## Mobile and platform boundaries

- Apply combined SDK safe areas once to controls, and verify fullscreen, short
  screens, cutouts, gestures and rotation. Keep score indicators stable and
  readable. Adapt input hints to the device; remove redundant hints after
  demonstrated learning while keeping onboarding separate from ranked rewards.
- Check advertised capabilities. Distinguish unsupported, denied, incomplete,
  empty and failed states. A missing public feature is a limitation to report,
  not permission to call internal services or invent compatibility transports.
- Verify signed launch identity on the backend. Use the documented contacts-proof
  flow for participant rankings. Never confuse own-contact consent with a list
  of contacts.
- Editor open is not publication. Valuable rewards require an authoritative
  documented result and idempotent server-side accounting.

## Verify the actual behavior

Exercise native Back/Cancel/repeated Back/Confirm, inactive/background/lock and
return, paused input, explicit Continue, late audio and navigation completion,
and safe areas at mobile sizes. Check interrupted falling and ending states.
Use deterministic SDK integration tests and real device verification for native
claims. Record platform/client limits: the SDK cannot emit a lifecycle event
that an older host never sends.
