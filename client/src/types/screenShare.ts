/**
 * Safe renderer contract for Electron screen sharing.
 *
 * Source ids are opaque and temporary: render the latest list, let the user
 * choose one, then immediately call selectShareSource followed by
 * getDisplayMedia from the same user gesture. `includeAudio` enables Windows
 * system loopback; Electron cannot guarantee per-application audio isolation.
 */
export type ShareSourceKind = 'screen' | 'window';

export interface ShareSource {
  id: string;
  name: string;
  kind: ShareSourceKind;
  thumbnailDataUrl: string | null;
  appIconDataUrl: string | null;
}

export interface ShareSourceSelection {
  sourceId: string;
  includeAudio: boolean;
}
