import { ref } from 'vue'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface Toast { id: string; type: ToastType; message: string }

const toasts = ref<Toast[]>([])

export function useToast() {
  function show(type: ToastType, message: string) {
    const id = crypto.randomUUID()
    toasts.value.push({ id, type, message })
    if (toasts.value.length > 5) toasts.value.shift()
    setTimeout(() => { toasts.value = toasts.value.filter(t => t.id !== id) }, 4000)
  }
  const success = (msg: string) => show('success', msg)
  const error = (msg: string) => show('error', msg)
  const warning = (msg: string) => show('warning', msg)
  const info = (msg: string) => show('info', msg)
  return { toasts, success, error, warning, info }
}
