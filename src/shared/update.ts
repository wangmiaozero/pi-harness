export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'verifying'
  | 'ready_to_install'
  | 'installing'
  | 'restarting'
  | 'completed'
  | 'failed'
  | 'manual_fallback'
export type UpdateReadiness =
  'NOT_READY' | 'MANUAL_ONLY' | 'DOWNLOAD_VERIFIED' | 'AUTO_INSTALL_VERIFIED'
export interface UpdatePreferences {
  autoCheck: boolean
  autoDownload: boolean
}
export interface UpdateFailure {
  code: string
  message: string
  retryable: boolean
}
export interface AppUpdateState {
  supported: boolean
  available: boolean
  currentVersion: string
  latestVersion: string | null
  status: UpdateStatus
  downloaded: boolean
  downloadProgress: number | null
  bytesReceived: number
  totalBytes: number | null
  bytesPerSecond: number
  fileName: string | null
  releaseNotes: string
  signature: 'unchecked' | 'verified' | 'missing' | 'invalid'
  integrity: 'unchecked' | 'verifying' | 'verified' | 'invalid'
  readiness: UpdateReadiness
  canInstall: boolean
  canResume: boolean
  autoDownloadAllowed: boolean
  preferences: UpdatePreferences
  error: UpdateFailure | null
}

/** True when a newer release should interrupt the user. Dismissal is not stored. */
export function shouldRemindUpdate(
  state: Pick<AppUpdateState, 'available' | 'status' | 'latestVersion' | 'currentVersion'> | null,
  dismissedVersion: string | null
): boolean {
  if (!state?.available || !state.latestVersion || state.latestVersion === state.currentVersion)
    return false
  if (state.latestVersion === dismissedVersion) return false
  return (
    state.status === 'available' ||
    state.status === 'manual_fallback' ||
    state.status === 'ready_to_install'
  )
}
