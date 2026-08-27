<script setup lang="ts">
import engineRadarImage from '@renderer/assets/themes/starship-cockpit/engine-radar-alpha.png'
import type { PetState } from '@shared/pet/types'

withDefaults(
  defineProps<{
    state?: PetState
    animated?: boolean
  }>(),
  { state: 'idle', animated: true }
)
</script>

<template>
  <aside
    class="starship-engine-hud pointer-events-none absolute bottom-0 left-0 z-[12] select-none"
    :data-animated="animated ? 'true' : 'false'"
    aria-hidden="true"
  >
    <div class="starship-engine-hud__radar">
      <img :src="engineRadarImage" alt="" draggable="false" />
      <span class="starship-engine-hud__sweep" />
      <span class="starship-engine-hud__echo" />
    </div>
    <div class="starship-engine-hud__status">
      <strong>STARSHIP STATUS</strong>
      <span>
        <i />
        系统状态
        <b>{{ state.toUpperCase() }}</b>
      </span>
      <span class="starship-engine-hud__power">
        <i />
        引擎功率
        <b>82%</b>
      </span>
      <span>
        <i />
        网络连接
        <b>STABLE</b>
      </span>
    </div>
  </aside>
</template>

<style scoped>
.starship-engine-hud {
  display: flex;
  width: var(--starship-left-dock-width, 376px);
  height: 150px;
  align-items: center;
  gap: 15px;
  padding: 20px 24px 16px 13px;
  border-top: 1px solid rgb(104 220 255 / 0.18);
  background: linear-gradient(108deg, rgb(1 7 19 / 0.96), rgb(3 15 34 / 0.88) 68%, transparent);
  box-shadow:
    inset 0 1px rgb(164 232 255 / 0.035),
    10px -8px 28px rgb(0 3 13 / 0.28);
  clip-path: polygon(0 0, 91% 0, 100% 18%, 100% 100%, 0 100%);
}

.starship-engine-hud__radar {
  position: relative;
  width: 112px;
  height: 112px;
  flex: 0 0 112px;
  overflow: hidden;
  border-radius: 50%;
  filter: drop-shadow(0 0 10px rgb(70 178 255 / 0.2));
}

.starship-engine-hud__radar img {
  display: block;
  width: 100%;
  height: 100%;
  max-width: none;
  object-fit: contain;
  opacity: 0.78;
  filter: saturate(0.86) brightness(0.74);
}

.starship-engine-hud__sweep {
  position: absolute;
  inset: 13px;
  border-radius: 50%;
  background: conic-gradient(
    from 0deg,
    transparent 0 82%,
    rgb(104 220 255 / 0.52) 96%,
    transparent
  );
  mix-blend-mode: screen;
  animation: starship-engine-radar-sweep 3.6s linear infinite;
}

.starship-engine-hud__echo {
  position: absolute;
  top: 42px;
  left: 68px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #86f8c8;
  box-shadow: 0 0 8px rgb(109 255 205 / 0.9);
  animation: starship-engine-radar-echo 2.1s ease-in-out infinite;
}

.starship-engine-hud__status {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 13px;
  font: 600 9px/1 var(--font-mono);
  color: rgb(135 187 220 / 0.54);
}

.starship-engine-hud__status strong {
  margin-bottom: 1px;
  color: rgb(137 219 255 / 0.7);
  font-size: 10px;
  letter-spacing: 0.14em;
}

.starship-engine-hud__status span {
  position: relative;
  display: grid;
  grid-template-columns: 5px 1fr auto;
  align-items: center;
  gap: 5px;
}

.starship-engine-hud__power::after {
  position: absolute;
  right: 0;
  bottom: -3px;
  width: 82px;
  height: 2px;
  background: linear-gradient(90deg, #67d8ff 0 82%, rgb(103 216 255 / 0.12) 82%);
  box-shadow: 0 0 5px rgb(103 216 255 / 0.28);
  content: '';
}

.starship-engine-hud__power i {
  background: #67d8ff;
  box-shadow: 0 0 6px rgb(103 216 255 / 0.62);
}

.starship-engine-hud__power b {
  color: rgb(126 218 255 / 0.84);
}

.starship-engine-hud__status i {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #65e5aa;
  box-shadow: 0 0 6px rgb(101 229 170 / 0.7);
}

.starship-engine-hud__status b {
  overflow: hidden;
  color: rgb(112 232 184 / 0.78);
  font-weight: 600;
  text-overflow: ellipsis;
}

[data-animated='false'] .starship-engine-hud__sweep,
[data-animated='false'] .starship-engine-hud__echo {
  animation: none;
}

@keyframes starship-engine-radar-sweep {
  to {
    transform: rotate(360deg);
  }
}

@keyframes starship-engine-radar-echo {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.72);
  }
  50% {
    opacity: 1;
    transform: scale(1.25);
  }
}

@media (max-width: 949px), (prefers-reduced-motion: reduce) {
  .starship-engine-hud__sweep,
  .starship-engine-hud__echo {
    animation: none;
  }
}

@media (max-width: 949px) {
  .starship-engine-hud {
    display: none;
  }
}
</style>
