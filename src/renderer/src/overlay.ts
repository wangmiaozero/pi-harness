import { createApp } from 'vue'
import ScreenMotionOverlay from './components/ui/ScreenMotionOverlay.vue'
import { applyTheme } from './utils/theme'
import { installAuthorWatermark } from './utils/author-watermark'
import './styles/overlay.css'

applyTheme('dark')
installAuthorWatermark()

createApp(ScreenMotionOverlay).mount('#app')
