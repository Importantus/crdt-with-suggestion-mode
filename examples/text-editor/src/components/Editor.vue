<script setup lang="ts">
import { useCodeMirror } from '@/composables/useCodeMirror';
import { ref } from 'vue';

// Eine ref, um das DOM-Element zu binden
const editorContainer = ref<HTMLDivElement | null>(null);

// Das Composable aufrufen, um den Editor zu initialisieren und zu verwalten
useCodeMirror(editorContainer);
</script>

<template>
  <div class="editor-wrapper" ref="editorContainer"></div>
</template>

<style>
.editor-wrapper {
  border: 1px solid #ccc;
  height: 500px;
  /* Oder eine andere Höhe */
}

/* Wichtig, damit der Editor die volle Höhe des Wrappers einnimmt */
.cm-editor {
  height: 100%;
}
</style>
