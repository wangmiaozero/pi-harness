import { AUTHOR_WATERMARK } from '@shared/constants/index'

const META_NAME = 'pi-harness-author-watermark'
const MARKER_ID = 'pi-harness-author-watermark'

/** Install a non-visual authorship marker in the runtime document. */
export function installAuthorWatermark(doc: Document = document): void {
  doc.documentElement.dataset.authorWatermark = AUTHOR_WATERMARK

  let meta = doc.head.querySelector<HTMLMetaElement>(`meta[name="${META_NAME}"]`)
  if (!meta) {
    meta = doc.createElement('meta')
    meta.name = META_NAME
    doc.head.append(meta)
  }
  meta.content = AUTHOR_WATERMARK

  let marker = doc.getElementById(MARKER_ID)
  if (!marker) {
    marker = doc.createElement('span')
    marker.id = MARKER_ID
    doc.body.append(marker)
  }
  marker.textContent = AUTHOR_WATERMARK
  marker.hidden = true
  marker.setAttribute('aria-hidden', 'true')
  marker.dataset.author = AUTHOR_WATERMARK
}
