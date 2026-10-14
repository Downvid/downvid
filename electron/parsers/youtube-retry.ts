import { classifyParseError } from '../../shared/parse-error'

export interface YoutubeRetryState { manifests: boolean; client: string }
export function nextYoutubeRetry(stderr: string, state: YoutubeRetryState, version: string): YoutubeRetryState | null {
  const kind = classifyParseError(stderr)
  if (kind === 'format-unavailable' && !state.manifests) return { ...state, manifests: true }
  if (kind === 'page-reload' && !state.client) {
    const current = /^\d{4}\.\d{2}\.\d{2}/.test(version) && version.slice(0, 10) >= '2026.10.10'
    return { ...state, client: current ? 'default,web_embedded,-tv_downgraded' : 'web_safari,web_embedded,-tv_downgraded' }
  }
  return null
}

export function youtubeExtractorArgs(state: YoutubeRetryState): string[] {
  const values = [state.manifests ? '' : 'skip=hls,dash', state.client ? `player_client=${state.client}` : ''].filter(Boolean)
  return values.length ? ['--extractor-args', `youtube:${values.join(';')}`] : []
}
