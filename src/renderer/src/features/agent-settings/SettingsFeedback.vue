<script setup lang="ts">
defineProps<{ busy?: boolean; error?: string; message?: string }>()
</script>
<template>
  <p v-if="error" role="alert" class="feature-error">{{ error }}</p>
  <p v-else-if="message" role="status" class="feature-success">{{ message }}</p>
  <p v-else-if="busy" role="status" class="feature-hint">{{ $t('agentSettings.loading') }}</p>
</template>
