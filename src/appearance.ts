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
  const update = () => {
    const snapshot = client.adapter.snapshot();
    const preference = environment.root.dataset.preference;
    const dark =
      preference === "dark" ||
      (preference !== "light" &&
        (snapshot.colorScheme === "dark" ||
          (!snapshot.colorScheme && environment.prefersDark())));
    environment.root.dataset.theme = dark ? "dark" : "light";
    environment.root.style.setProperty(
      "--host-top",
      `${Math.max(snapshot.safeArea?.top ?? 0, snapshot.contentSafeArea?.top ?? 0)}px`,
    );
    environment.root.style.setProperty(
      "--host-bottom",
      `${Math.max(snapshot.safeArea?.bottom ?? 0, snapshot.contentSafeArea?.bottom ?? 0)}px`,
    );
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
    releases.push(client.on("themeChanged", update));
    releases.push(client.on("viewportChanged", update));
    releases.push(client.on("safeAreaChanged", update));
    releases.push(client.on("contentSafeAreaChanged", update));
  } catch (error) {
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
    for (const release of releases) {
      try {
        release();
      } catch {
        /* Continue releasing remaining listeners. */
      }
    }
  };
}
