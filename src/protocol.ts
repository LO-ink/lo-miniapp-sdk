/** Stable, platform-neutral features a host can advertise. */
export const MINI_APP_CAPABILITIES = [
  "ready",
  "expand",
  "fullscreen",
  "hideKeyboard",
  "orientation",
  "backButton",
  "mainButton",
  "secondaryButton",
  "settingsButton",
  "closingConfirmation",
  "headerColor",
  "backgroundColor",
  "bottomBarColor",
  "haptics",
  "popup",
  "openLink",
  "sendData",
  "switchInlineQuery",
  "clipboard",
  "location",
  "biometry",
  "sensors",
  "downloadFile",
  "qrScanner",
  "requestWriteAccess",
  "requestContact",
  "shareMessage",
  "shareToStory",
  "invoice",
  "cloudStorage",
  "deviceStorage",
  "secureStorage",
] as const;

export type Capability = (typeof MINI_APP_CAPABILITIES)[number];

export const MINI_APP_PROTOCOL_VERSION = 1 as const;

export const MINI_APP_LIMITS = Object.freeze({
  envelopeBytes: 65_536,
  sendDataBytes: 4_096,
  inlineQueryLength: 256,
  qrPromptLength: 64,
  preparedMessageIdLength: 128,
});

export type Insets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};
export type ColorScheme = "light" | "dark";
export type ThemeColors = {
  background?: string;
  text?: string;
  mutedText?: string;
  link?: string;
  action?: string;
  actionText?: string;
  secondaryBackground?: string;
  headerBackground?: string;
  accentText?: string;
  sectionBackground?: string;
  sectionHeaderText?: string;
  subtitleText?: string;
  destructiveText?: string;
  bottomBarBackground?: string;
};
export type HostSnapshot = {
  colorScheme?: ColorScheme;
  theme?: Readonly<ThemeColors>;
  viewportHeight?: number;
  stableViewportHeight?: number;
  safeArea?: Insets;
  contentSafeArea?: Insets;
  isFullscreen?: boolean;
  isOrientationLocked?: boolean;
};

export type MiniAppEventMap = {
  activated: undefined;
  deactivated: undefined;
  themeChanged: HostSnapshot;
  viewportChanged: HostSnapshot;
  safeAreaChanged: Insets;
  contentSafeAreaChanged: Insets;
  fullscreenChanged: boolean;
  fullscreenFailed: { reason?: string };
  backButtonClicked: undefined;
  mainButtonClicked: undefined;
  secondaryButtonClicked: undefined;
  settingsButtonClicked: undefined;
  qrTextReceived: { data: string };
  qrScannerClosed: undefined;
  accelerometerChanged: { x: number; y: number; z: number };
  accelerometerFailed: { reason?: string };
  gyroscopeChanged: { x: number; y: number; z: number };
  gyroscopeFailed: { reason?: string };
  orientationFailed: { reason?: string };
  orientationChanged: {
    absolute: boolean;
    alpha: number;
    beta: number;
    gamma: number;
  };
};

export type MiniAppEvent = keyof MiniAppEventMap;
export type ButtonId = "back" | "main" | "secondary" | "settings";
export type ButtonParams = {
  text?: string;
  active?: boolean;
  visible?: boolean;
  progressVisible?: boolean;
  color?: string;
  textColor?: string;
  shine?: boolean;
  position?: "left" | "right" | "top" | "bottom";
};
export type StoryShareParams = {
  text?: string;
  link?: { url: string; name?: string };
};
export type LocationData = {
  latitude: number;
  longitude: number;
  altitude: number | null;
  course: number | null;
  speed: number | null;
  horizontalAccuracy: number | null;
  verticalAccuracy: number | null;
  courseAccuracy: number | null;
  speedAccuracy: number | null;
};
export type BiometryInfo = {
  available: boolean;
  type: "finger" | "face" | "unknown";
  accessRequested: boolean;
  accessGranted: boolean;
  tokenSaved: boolean;
  deviceId: string;
};
export type SensorOptions = { refreshRate?: number };
export type InvoiceStatus = "paid" | "cancelled" | "failed" | "pending";
export type RequestContext = { signal?: AbortSignal };

export type MiniAppOperationMap = {
  ready: { input: undefined; output: void };
  expand: { input: undefined; output: void };
  requestFullscreen: { input: undefined; output: void };
  exitFullscreen: { input: undefined; output: void };
  hideKeyboard: { input: undefined; output: void };
  setOrientationLock: { input: { locked: boolean }; output: void };
  setButton: {
    input: { button: ButtonId; params: ButtonParams };
    output: void;
  };
  setClosingConfirmation: { input: { enabled: boolean }; output: void };
  setHeaderColor: { input: { color: string }; output: void };
  setBackgroundColor: { input: { color: string }; output: void };
  setBottomBarColor: { input: { color: string }; output: void };
  haptic: {
    input: {
      kind:
        | "success"
        | "warning"
        | "error"
        | "light"
        | "medium"
        | "heavy"
        | "rigid"
        | "soft";
    };
    output: void;
  };
  showPopup: {
    input: {
      title?: string;
      message: string;
      buttons?: readonly {
        id?: string;
        text?: string;
        kind?: "default" | "ok" | "close" | "cancel" | "destructive";
      }[];
    };
    output: string | undefined;
  };
  openLink: {
    input: { url: string; instantView?: boolean; externalBrowser?: boolean };
    output: void;
  };
  sendData: { input: { data: string }; output: void };
  switchInlineQuery: {
    input: {
      query: string;
      chatTypes?: readonly ("users" | "bots" | "groups" | "channels")[];
    };
    output: void;
  };
  readClipboard: { input: undefined; output: string | null };
  getLocation: { input: undefined; output: LocationData | null };
  openLocationSettings: { input: undefined; output: void };
  getBiometryInfo: { input: undefined; output: BiometryInfo };
  requestBiometryAccess: { input: { reason?: string }; output: boolean };
  authenticateBiometry: {
    input: { reason?: string };
    output: { authenticated: boolean; token?: string };
  };
  updateBiometryToken: { input: { token: string }; output: boolean };
  openBiometrySettings: { input: undefined; output: void };
  startAccelerometer: { input: SensorOptions; output: boolean };
  stopAccelerometer: { input: undefined; output: boolean };
  startGyroscope: { input: SensorOptions; output: boolean };
  stopGyroscope: { input: undefined; output: boolean };
  startDeviceOrientation: {
    input: SensorOptions & { absolute?: boolean };
    output: boolean;
  };
  stopDeviceOrientation: { input: undefined; output: boolean };
  downloadFile: { input: { url: string; fileName: string }; output: boolean };
  openQrScanner: { input: { text?: string }; output: void };
  closeQrScanner: { input: undefined; output: void };
  requestWriteAccess: { input: undefined; output: boolean };
  requestContact: { input: undefined; output: boolean };
  shareMessage: { input: { id: string }; output: boolean };
  shareToStory: {
    input: { mediaUrl: string; params?: StoryShareParams };
    output: void;
  };
  openInvoice: { input: { url: string }; output: InvoiceStatus };
  cloudStorageSet: { input: { key: string; value: string }; output: boolean };
  cloudStorageGet: { input: { key: string }; output: string };
  cloudStorageGetMany: {
    input: { keys: readonly string[] };
    output: Record<string, string>;
  };
  cloudStorageRemove: { input: { key: string }; output: boolean };
  cloudStorageRemoveMany: {
    input: { keys: readonly string[] };
    output: boolean;
  };
  cloudStorageKeys: { input: undefined; output: string[] };
  deviceStorageSet: { input: { key: string; value: string }; output: boolean };
  deviceStorageGet: { input: { key: string }; output: string | null };
  deviceStorageRemove: { input: { key: string }; output: boolean };
  deviceStorageClear: { input: undefined; output: boolean };
  secureStorageSet: { input: { key: string; value: string }; output: boolean };
  secureStorageGet: {
    input: { key: string };
    output: { value: string | null; canRestore: boolean };
  };
  secureStorageRestore: { input: { key: string }; output: string };
  secureStorageRemove: { input: { key: string }; output: boolean };
  secureStorageClear: { input: undefined; output: boolean };
};

export type MiniAppOperation = keyof MiniAppOperationMap;
export type OperationInput<K extends MiniAppOperation> =
  MiniAppOperationMap[K]["input"];
export type OperationOutput<K extends MiniAppOperation> =
  MiniAppOperationMap[K]["output"];
