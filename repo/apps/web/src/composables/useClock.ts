import { ref, onUnmounted } from 'vue'

export function useClock() {
  const now = ref(new Date())
  const handle = setInterval(() => { now.value = new Date() }, 1000)
  onUnmounted(() => clearInterval(handle))
  return { now }
}
