<script setup lang="ts">
// No imports needed
</script>

<template>
  <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--color-background);">
    <div style="text-align: center; padding: 48px 24px;">
      <p style="font-size: 5rem; margin-bottom: 16px;">404</p>
      <h1 style="font-size: 24px; font-weight: 700; margin-bottom: 12px;">Page Not Found</h1>
      <p class="text-muted" style="margin-bottom: 24px;">The page you're looking for doesn't exist or has been moved.</p>
      <RouterLink to="/listings" class="btn btn-primary">← Back to Listings</RouterLink>
    </div>
  </div>
</template>
