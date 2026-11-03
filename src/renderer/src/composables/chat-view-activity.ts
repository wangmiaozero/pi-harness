import { inject, ref, type InjectionKey, type Ref } from 'vue'

// Presentation activity only. Agent events and persistence remain owned by stores/Main.
export const CHAT_VIEW_ACTIVE: InjectionKey<Readonly<Ref<boolean>>> = Symbol('chat-view-active')
export function useChatViewActive(): Readonly<Ref<boolean>> {
  return inject(CHAT_VIEW_ACTIVE, ref(true))
}
