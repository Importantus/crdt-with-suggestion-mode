<script setup lang="ts">
import { ref } from 'vue';
import Editor from './components/Editor.vue';
import { useCollabStore } from './stores/collab';

const collabStore = useCollabStore();
collabStore.initialize()

const newName = ref("")
</script>

<template>
  <input type="checkbox" v-model="collabStore.isSuggestionMode">
  <div @click="collabStore.setActiveDocument(doc.id)" v-for="doc in collabStore.documents.values()">{{ doc.fileName }}
  </div>
  <input type="text" v-model="newName">
  <button @click="collabStore.createDocument(newName)">+</button>
  <Editor />
</template>
