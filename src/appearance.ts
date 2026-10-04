import type { MiniAppClient } from "./client.js";

type AppearanceEnvironment = {
  root: {
    dataset: Record<string, string | undefined>;
    style: { setProperty(name: string, value: string): void };
  };
  prefersDark(): boolean;
  background(variable: string): string;
  onPreferenceChange(listener: () => void): () => void;
};

/** Binds normalized host appearance without reading a platform global. */
export function bindAppearance(
  client: MiniAppClient | null,
  environment: AppearanceEnvironment,
  options: { backgroundVariable?: string } = {},
): () => void {
  if (!client) return () => {};
  let active = true;
  const update = () => {
    if (!active || client.disposed) return;
    const snapshot = client.adapter.snapshot();
    const preference = environment.root.dataset.preference;
    const dark =
      preference === "dark" ||
      (preference !== "light" &&
        (snapshot.colorScheme === "dark" ||
          (!snapshot.colorScheme && environment.prefersDark())));
    environment.root.dataset.theme = dark ? "dark" : "light";
    if (
      snapshot.safeArea !== undefined ||
      snapshot.contentSafeArea !== undefined
    )
      for (const edge of ["top", "bottom"] as const) {
        const safe = snapshot.safeArea?.[edge] ?? 0,
          content = snapshot.contentSafeArea?.[edge] ?? 0;
        if (
          Number.isFinite(safe) &&
          Number.isFinite(content) &&
          safe >= 0 &&
          content >= 0 &&
          Number.isFinite(safe + content)
        )
          environment.root.style.setProperty(
            `--host-${edge}`,
            `${safe + content}px`,
          );
      }
    const background = environment
      .background(options.backgroundVariable ?? "--page-background")
      .trim();
    if (/^#[0-9a-f]{6}$/i.test(background)) {
      if (client.supports("headerColor"))
        void client
          .call("setHeaderColor", { color: background })
          .catch(() => {});
      if (client.supports("backgroundColor"))
        void client
          .call("setBackgroundColor", { color: background })
          .catch(() => {});
    }
  };
  update();
  const releases: Array<() => void> = [];
  try {
    releases.push(environment.onPreferenceChange(update));
    for (const event of [
      "themeChanged",
      "viewportChanged",
      "safeAreaChanged",
      "contentSafeAreaChanged",
    ] as const) {
      try {
        releases.push(client.on(event, update));
      } catch (error) {
        // Appearance is optional. Keep the initial snapshot, system preference
        // and every event the host actually provides; propagate real failures.
        if (
          !error ||
          typeof error !== "object" ||
          !("code" in error) ||
          error.code !== "unsupported"
        )
          throw error;
      }
    }
  } catch (error) {
    active = false;
    for (const release of releases) {
      try {
        release();
      } catch {
        /* Continue releasing previously bound listeners. */
      }
    }
    throw error;
  }
  return () => {
    if (!active) return;
    active = false;
    for (const release of releases) {
      try {
        release();
      } catch {
        /* Continue releasing remaining listeners. */
      }
    }
  };
}
