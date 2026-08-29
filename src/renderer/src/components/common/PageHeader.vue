<template>
  <header class="page-header" data-testid="page-header">
    <slot />
  </header>
</template>

<style scoped>
.page-header {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  height: var(--height-page-header);
  padding: 0 var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
}
</style>
