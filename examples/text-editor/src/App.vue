<script setup lang="ts">
import { ref } from 'vue';
import Editor from './components/Editor.vue';
import { useCollabStore } from './stores/collab';
import { useDocumentStore } from './stores/document';

const collabStore = useCollabStore();
collabStore.initialize()

const documentStore = useDocumentStore()

const newName = ref("")
</script>

<template>

  <body class="bg-gray-100 h-screen p-2">
    <div class="w-full flex justify-between items-center">
      <div>
        <div class="flex gap-2">
          <div class=" w-fit p-2 rounded text-sm cursor-pointer"
            :class="{ 'bg-gray-400': collabStore.activeDocumentId === doc.id, ' bg-gray-200': collabStore.activeDocumentId !== doc.id }"
            @click="collabStore.setActiveDocument(doc.id)" v-for="doc in collabStore.documents.values()">{{ doc.fileName
            }}
          </div>
        </div>
      </div>
      <div class="p-2 gap-2">
        <input type="checkbox" name="Vorschlagsmodus" v-model="collabStore.isSuggestionMode">
        <label for="Vorschlagsmodus">Vorschlagsmodus</label>
      </div>
    </div>
    <div class="">
      <div>
        <input type="text" class="border rounded" v-model="newName">
        <button @click="collabStore.createDocument(newName)" class="cursor-pointer px-2 ml-2 bg-amber-200">+</button>
      </div>
    </div>
    <Editor />
    <div>
      <div v-for="suggestion in documentStore.suggestions">{{ suggestion }}</div>
    </div>
  </body>
</template>
