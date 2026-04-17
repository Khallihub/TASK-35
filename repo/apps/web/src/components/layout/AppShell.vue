<script setup lang="ts">
import { ref } from 'vue'
import Sidebar from './Sidebar.vue'
import TopBar from './TopBar.vue'
const collapsed = ref(false)
</script>

<template>
  <div class="shell" :class="{ 'shell-collapsed': collapsed }">
    <Sidebar :collapsed="collapsed" @toggle="collapsed = !collapsed" />
    <div class="shell-main">
      <TopBar />
      <main class="shell-content">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
.shell { display: flex; height: 100vh; overflow: hidden; }
.shell-main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
.shell-content { flex: 1; overflow-y: auto; padding: 24px; }
</style>
