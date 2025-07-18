<script setup lang="ts">
import { useCollabStore } from '@/stores/collab'
import type { DocumentID } from 'track-changes-application'

const props = defineProps<{
  document: {
    id: DocumentID
    fileName: string
  }
}>()

const collabStore = useCollabStore()
</script>

<template>
  <div
    class="w-fit p-2 rounded-xs text-sm cursor-pointer flex items-center transition-all"
    :class="{
      'bg-white': collabStore.activeDocumentId === props.document.id,
      'bg-transparent hover:bg-gray-300': collabStore.activeDocumentId !== props.document.id,
    }"
    @click="collabStore.setActiveDocument(props.document.id)"
  >
    {{ props.document.fileName }}
  </div>
</template>
