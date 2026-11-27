<script setup lang="ts">
import Button from '@renderer/components/ui/Button.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import {
  piMaintenanceSelection,
  resolvePiMaintenanceTarget
} from '@renderer/composables/usePiMaintenanceTarget'
</script>

<template>
  <Dialog
    :open="piMaintenanceSelection !== null"
    :title="
      $t(
        piMaintenanceSelection?.action === 'reinstall'
          ? 'overview.reinstallPi'
          : 'overview.updatePi'
      )
    "
    :description="$t('overview.choosePiTarget')"
    close-on-escape
    @update:open="
      (open) => {
        if (!open) resolvePiMaintenanceTarget(null)
      }
    "
  >
    <div v-if="piMaintenanceSelection" class="grid gap-2">
      <Button @click="resolvePiMaintenanceTarget('bundled')">
        {{ $t('overview.bundledPi') }}
      </Button>
      <Button
        aria-describedby="pi-terminal-installation"
        @click="resolvePiMaintenanceTarget('terminal')"
      >
        {{ $t('overview.terminalPi') }}
        <span v-if="piMaintenanceSelection.terminal.version" class="text-[var(--text-secondary)]">
          {{ piMaintenanceSelection.terminal.version }}
        </span>
      </Button>
      <p
        id="pi-terminal-installation"
        class="break-all text-center font-mono text-[11px] text-[var(--text-tertiary)]"
      >
        {{ piMaintenanceSelection.terminal.cliPath }}
      </p>
    </div>
    <template #footer>
      <Button variant="ghost" @click="resolvePiMaintenanceTarget(null)">{{
        $t('common.cancel')
      }}</Button>
    </template>
  </Dialog>
</template>
