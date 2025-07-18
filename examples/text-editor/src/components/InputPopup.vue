<template>
  <div ref="wrapper" class="inline-block relative z-10">
    <button ref="trigger" @click="togglePopup" class="cursor-pointer h-full">
      <slot name="trigger">Open Input</slot>
    </button>
    <div v-if="visible" ref="popup" :style="popupPosition"
      class="fixed z-50 bg-gray-200 p-2 flex flex-col items-end gap-2 rounded-lg shadow-lg min-w-[200px]">
      <input v-model="inputValue" @keyup.enter="confirm" ref="inputField"
        class="w-full bg-gray-100 rounded p-2 border border-gray-300 focus:outline-none text-sm" type="text" />
      <button @click="confirm" class="p-1 px-2 w-full bg-gray-100 rounded-full text-sm text-gray-600">
        OK
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

// Props and Emits
const props = defineProps({
  modelValue: {
    type: String,
    default: '',
  },
})
const emit = defineEmits(['update:modelValue', 'confirm'])

// Refs
const visible = ref(false)
const inputValue = ref(props.modelValue)
const trigger = ref<HTMLElement | null>(null)
const popup = ref<HTMLElement | null>(null)

// Watch for external modelValue changes
watch(
  () => props.modelValue,
  (newVal) => {
    inputValue.value = newVal
  },
)

// Toggle Popup Visibility
const togglePopup = async () => {
  visible.value = !visible.value
  if (visible.value) {
    await nextTick()
    document.addEventListener('mousedown', onClickOutside)
    focusInput()
  } else {
    removeClickOutside()
  }
}

// Compute Popup Position (top & left)
const popupPosition = computed(() => {
  if (!trigger.value || !popup.value) return {}

  // Get bounding boxes
  const triggerRect = trigger.value.getBoundingClientRect()
  const popupRect = popup.value.getBoundingClientRect()

  // Initial coordinates (10px below trigger, centered horizontally)
  let top = triggerRect.bottom + window.scrollY + 10
  let left = (triggerRect.left + triggerRect.right) / 2 + window.scrollX - popupRect.width / 2

  // Clamp to keep at least 5px from each viewport edge
  const minX = 5
  const minY = 5
  const maxX = window.innerWidth - popupRect.width - 5
  const maxY = window.innerHeight - popupRect.height - 5

  top = Math.min(Math.max(top, minY), maxY)
  left = Math.min(Math.max(left, minX), maxX)

  return {
    top: `${top}px`,
    left: `${left}px`,
  }
})

// Focus Input Field
const focusInput = () => {
  if (popup.value) {
    const input = popup.value.querySelector('input')
    input && input.focus()
  }
}

// Confirm Input and Emit
const confirm = () => {
  emit('update:modelValue', inputValue.value)
  emit('confirm', inputValue.value)
  closePopup()
}

// Close Popup Helper
const closePopup = () => {
  visible.value = false
  removeClickOutside()
}

// Remove Outside Click Listener
const removeClickOutside = () => {
  document.removeEventListener('mousedown', onClickOutside)
}

// Detect Clicks Outside
const onClickOutside = (e: any) => {
  if (
    popup.value &&
    trigger.value &&
    !popup.value.contains(e.target) &&
    !trigger.value.contains(e.target)
  ) {
    closePopup()
  }
}

// Cleanup on Unmount
onBeforeUnmount(() => {
  removeClickOutside()
})
</script>
