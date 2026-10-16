export type ReleaseChannel = 'community' | 'verified'
export interface ReleasePolicy {
  channel: ReleaseChannel
  updateMode: 'manual' | 'automatic'
}
