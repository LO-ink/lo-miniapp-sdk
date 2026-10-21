# Building games for LO Mini Apps

Use the public `@lo-ink/miniapp-sdk` contract and your own application backend.
This guide applies to canvas, WebGL and DOM games. Rendering libraries and game
rules remain your choice.

## Treat activity and game state separately

A visible web page is not necessarily an active Mini App. A native confirmation,
covered screen, incoming call or minimized application may leave its document
visible. Subscribe to the public `deactivated` event as well as browser
`visibilitychange` and `blur`.

| Event                                                     | Simulation  | Input                 | Sound                              | Return behavior                          |
| --------------------------------------------------------- | ----------- | --------------------- | ---------------------------------- | ---------------------------------------- |
| Player presses Pause                                      | Frozen      | Only pause controls   | Suspended                          | Explicit Continue                        |
| Host emits `deactivated`                                  | Frozen      | Blocked               | Suspended                          | Wait for host activation                 |
| Document hidden or window blurred                         | Frozen      | Clear held input      | Suspended                          | Explicit Continue                        |
| Host emits `activated`, document visible or focus returns | Keep paused | Only visible controls | Keep suspended during a paused run | Reset frame clock; never call Resume     |
| Player presses Continue while active                      | Running     | Gameplay enabled      | Restore saved preferences          | Reset frame clock and accumulator        |
| Confirmed exit or unmount                                 | Stop loop   | Remove handlers       | Stop and release owned resources   | Do not briefly reactivate before leaving |

Keep host activity, document visibility, player pause and the user's audio
preference as separate state. Clearing one suspension reason must not clear
another. Model an unfinished ending animation explicitly if it still affects the
result or can lose player progress.

The following is a **policy example**, not an SDK helper. Supply renderer-specific
hooks. All game input paths, including accessibility controls and test bots,
should use `canPlay()`. `setAudioBlocked` must guard every audio resume path,
including gesture unlocking and late `AudioContext.resume()` completion.

```ts
import type { MiniAppClient } from "@lo-ink/miniapp-sdk";

interface GameHooks {
  unfinished(): boolean;
  pause(): void;
  resume(): void;
  resetClock(): void;
  clearInput(): void;
  setAudioBlocked(blocked: boolean): void;
}

export function bindGameActivity(client: MiniAppClient, game: GameHooks) {
  let hostActive = true;
  let paused = false;
  let focused = true;
  const canPlay = () => hostActive && focused && !document.hidden && !paused;
  const updateAudio = () =>
    game.setAudioBlocked(!hostActive || !focused || document.hidden || paused);
  const interrupt = () => {
    game.clearInput();
    game.resetClock();
    if (game.unfinished()) {
      paused = true;
      game.pause();
    }
    updateAudio();
  };
  const visibility = () => {
    if (document.hidden) interrupt();
    else {
      game.resetClock();
      updateAudio();
    }
  };
  const blur = () => {
    focused = false;
    interrupt();
  };
  const focus = () => {
    focused = true;
    game.resetClock();
    updateAudio();
  };
  let offDeactivate = () => {};
  let offActivate = () => {};
  try {
    offDeactivate = client.on("deactivated", () => {
      hostActive = false;
      interrupt();
    });
    offActivate = client.on("activated", () => {
      hostActive = true;
      game.resetClock();
      updateAudio();
    });
  } catch (error) {
    offDeactivate();
    offActivate();
    console.warn(
      "Host lifecycle events unavailable; browser handling remains active",
      error,
    );
  }
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("blur", blur);
  window.addEventListener("focus", focus);
  visibility();
  return {
    canPlay,
    pause: interrupt,
    resetRunPause() {
      game.resetClock();
      game.clearInput();
      paused = false;
      updateAudio();
    },
    continue() {
      if (!paused || !hostActive || !focused || document.hidden) return;
      game.resetClock();
      game.clearInput();
      paused = false;
      game.resume();
      updateAudio();
    },
    dispose() {
      offDeactivate();
      offActivate();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
      game.clearInput();
      game.setAudioBlocked(true);
    },
  };
}
```

Call the binding once per mounted game, before accepting gameplay input, and
release it before disposing the SDK client. Call `resetRunPause()` when deliberately replacing a run or returning to the
menu, after your screen state machine has retired the old run and its pause UI.
It clears only player pause; host, focus and visibility gates remain intact.
Never call it from an activation, visibility or focus handler.
Do not infer host activity from arbitrary SDK request success. If lifecycle event
subscription is unavailable, report the host limitation and keep browser activity
handling; do not switch to a private or legacy transport.

## Let the host own exit

For a game without internal native Back navigation, keep the SDK Back control
hidden with `setButton({button: 'back', params: {visible: false}})`. Enable
`setClosingConfirmation({enabled: true})` while a run is unfinished, including its
pause screen. Check the corresponding public capabilities before calling either
operation. The host handles system Back and exit confirmation. Avoid translating
native Back into a synthetic Escape or a pause toggle: a second Back must not
silently resume a run.

An app that intentionally uses SDK Back for nested screens needs a separate,
explicit navigation policy. Keyboard Escape can close an internal panel or pause
a run; repeated Escape should not accidentally resume it.

**Host compatibility:** pausing before the native exit confirmation requires a
host that emits `deactivated` before presenting that confirmation. The SDK cannot
invent this event. Older clients may continue running behind that dialog even
when document visibility is unchanged. Verify the actual client release; a new
web deployment alone does not establish native support.

Host implementers should keep an activity owner for each native presentation.
Cancel may restore host activity, but must not resume the game itself. Successful
exit must not emit an intermediate activation. Failed asynchronous navigation
must release its own owner. Late callbacks after reload, account change or
unmount must never activate a newer document or release another dialog's owner.

## Pause simulation, input and audio together

- Freeze the fixed-step accumulator and game clock. Reset the previous frame
  timestamp on return so elapsed background time cannot become catch-up steps.
  Preserve authoritative replay ticks independently of wall-clock interruptions.
- Clear held keys, pending actions, gestures and pointer capture. Guard canvas
  handlers as well as keyboard, gamepad, accessibility and automated input.
  A Continue click must not also trigger a gameplay action through bubbling.
- Stop audio scheduling and suspend the AudioContext during interruption.
  `unlock()`, visibility handlers, settings toggles and autostart must obey the
  same suspension gate. After any awaited resume, check the gate again before
  scheduling sound. Preserve the user's music and effects settings.
- Resume only after an explicit player action while the host and document are
  active. Returning focus or receiving `activated` updates availability and the
  frame clock; neither is a command to continue an unfinished run.

## Make the surface fit a mobile game

Use `bindSafeAreaCss(client)` and its combined system/content insets. Apply those
insets once to interactive chrome; the world background can extend behind it.
Use `100dvh` with a viewport fallback rather than a fixed desktop height. Verify
short screens, cutouts, bottom gestures, rotation and native host controls.
Fullscreen support, window expansion and safe-area updates are separate
capabilities. A granted fullscreen request does not remove safe-area obligations.

Keep lives, current score and record in stable positions with readable labels and
numbers. Use device-appropriate input hints instead of always referring to a
keyboard. Teach actions through short interactive steps, then hide redundant
hints after demonstrated mastery. Persist that choice per authenticated player;
keep training separate from ranked runs and rewards.

Animation should explain state changes: a pickup, damage, invulnerability or
speed effect should be distinguishable. Avoid relying only on color, sound or
haptics. Support reduced motion and preserve legibility over layered backgrounds.
Spawn difficulty should leave reachable gaps at the player's actual speed.
Reserve falling trajectories when pickups and hazards must not overlap, rather
than checking only their initial positions.

## Keep platform integration portable and truthful

- Authenticate signed launch data on your backend. SDK discovery or decoded
  launch fields do not establish identity. Keep app keys and server credentials
  off the web page.
- Access platform features through advertised public SDK capabilities. Do not
  call internal contact, messaging or profile services directly from a game or
  introduce an undocumented proxy that other developers cannot use.
- `requestContact` shares the current person's own contact. Contacts ranking uses
  `requestContactsProof` and server verification for your app's participants.
  Unsupported, denied, incomplete and verified-empty are different states. See
  the [contacts recipe](../README.md#mutual-contacts-without-a-private-service-connection).
- Opening a share editor or resolving `navigator.share()` is not a verified
  publication. Award valuable currency only from an authoritative, documented
  completion signal. If no such public feature exists, explain the limitation
  instead of granting a reward on editor open or adding private service access.
- Keep purchases and score rewards server-authoritative, atomic and idempotent.
  Do not turn an optimistic UI update into a second reward on retry. Keep old
  signed run rules verifiable when deploying new mechanics.

## Verify before release

| Scenario                                                     | Expected result                                                                  |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| First native Back during play                                | Exit confirmation appears; run and audio are already paused on a supporting host |
| Cancel, repeated Back, Cancel again                          | No automatic resume; a fresh exit dialog still works                             |
| Confirm exit                                                 | App leaves without a transient activation                                        |
| Call, screen lock, application switch, covered native screen | Run stops immediately; returning presents Continue                               |
| Pointer, Space, Enter and held input while paused            | No gameplay or replay changes                                                    |
| Continue                                                     | Clock restarts cleanly; the same click does not perform a game action            |
| Interrupted falling object or ending animation               | State remains frozen and can finish normally after Continue                      |
| Late audio resume or asynchronous navigation completion      | Cannot unlock a blocked or replacement screen                                    |
| 320px width, short viewport, cutout and bottom gesture area  | Chrome and primary controls remain readable and reachable                        |
| Consent denied, old host, offline backend and retry          | Distinct honest states; no private fallback or duplicate rewards                 |

Use a public SDK port stub for deterministic integration checks, then test the
real native exit confirmation and OS lifecycle on supported devices. Report the
exact clients and platforms exercised. Browser event simulation does not prove
that an installed native host sends the required events.
