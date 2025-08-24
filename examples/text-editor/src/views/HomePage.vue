<script setup lang="ts">
import router from '@/router'
import { getUserColor, users, useUserStore } from '@/stores/user'
import { Cursors } from '@collabs/collabs'
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import Annotation from '../components/AnnotationComment.vue'
import Editor from '../components/CodeMirrorEditor.vue'
import InputPopup from '../components/InputPopup.vue'
import Tab from '../components/Tab.vue'
import { useCollabStore } from '../stores/collab'
import { useDocumentStore } from '../stores/document'

const collabStore = useCollabStore()
const userStore = useUserStore()

if (userStore.activeUser === null) {
  router.push('/login')
} else {
  collabStore.initialize(userStore.activeUser.id)
}

const documentStore = useDocumentStore()

const container = ref<HTMLElement>()
const commentPanel = ref<HTMLElement>()

const newName = ref('')
const newComment = ref('')

const isContainerScrolled = ref(false)

const sortedAnnotations = computed(() => {
  return Array.from(documentStore.annotations.values()).sort((a, b) => {
    const aIdx = a.startPosition ? documentStore.document?.content.indexOfPosition(a.startPosition, 'left') ?? 0 : 0
    const bIdx = b.startPosition ? documentStore.document?.content.indexOfPosition(b.startPosition, 'left') ?? 0 : 0
    return aIdx - bIdx
  })
})

const annotationPositions = reactive<Record<string, number>>({})

function addComment() {
  if (!newComment.value.trim()) return
  const content = documentStore.document?.content
  if (!content) return
  // Get the current selection start index
  const startPosition = collabStore.presence.get(collabStore.replicaId)?.selection?.anchor
  const endPosition = collabStore.presence.get(collabStore.replicaId)?.selection?.head
  if (startPosition === undefined || endPosition === undefined) return

  const startIndex = Cursors.toIndex(startPosition, content)
  const endIndex = Cursors.toIndex(endPosition, content)
  if (startIndex === -1 || endIndex === -1) return

  const [start, end] = [startIndex, endIndex].sort((a, b) => a - b)

  documentStore.addComment(start, end - 1, newComment.value.trim())

  newComment.value = ''
}

function onContainerScroll(event: Event) {
  const target = event.target as HTMLElement
  isContainerScrolled.value = target.scrollTop > 10

  // updateAnnotationPositions()
}

async function updateAnnotationPositions(awaitForNextTick = true) {
  if (awaitForNextTick) {
    await nextTick()
  }

  const rawPositions: { id: string; top: number; height: number }[] = []
  const contEl = container.value!
  const contRect = contEl.getBoundingClientRect()
  const panelEl = commentPanel.value!

  for (const sug of sortedAnnotations.value) {
    const span = document.querySelector<HTMLElement>(`span[data-annotation-id="${sug.id}"]`)
    if (!span) continue
    const spanRect = span.getBoundingClientRect()
    const topRel = spanRect.top - contRect.top + contEl.scrollTop

    const commentEl = panelEl.querySelector<HTMLElement>(
      `[data-annotation-comment-id="${sug.id}"]`
    )
    const commentHeight = commentEl
      ? commentEl.getBoundingClientRect().height
      : 0

    rawPositions.push({ id: sug.id, top: topRel, height: commentHeight })
  }

  rawPositions.sort((a, b) => a.top - b.top)
  const margin = 8
  let prevBottom = -Infinity

  for (const { id, top, height } of rawPositions) {
    const desired = Math.max(top, prevBottom + margin)
    annotationPositions[id] = desired
    prevBottom = desired + height
  }
}

onMounted(() => {
  window.addEventListener('beforeunload', () => {
    collabStore.leaveDocument()
  })

  setTimeout(() => {
    updateAnnotationPositions()
  }, 100)
})

watch(sortedAnnotations, () => {
  setTimeout(() => {
    updateAnnotationPositions()
  }, 100)
})
</script>

<template>

  <body class="bg-gray-100 h-screen  relative flex flex-col overflow-hidden">
    <div class="w-full flex justify-between px-3 py-4 items-center relative z-10 transition-all duration-300"
      :class="{ 'shadow': isContainerScrolled }">
      <div>
        <div class="flex bg-gray-200 rounded-full overflow-hidden">
          <Tab class="first:pl-3" v-for="doc in collabStore.documents.values()" :key="doc.id" :document="doc" />
          <InputPopup class="first:border-l-0 border-l-1 border-gray-50" v-model="newName"
            @confirm="collabStore.createDocument(newName)">
            <template #trigger>
              <div
                class="in-last:pr-3 in-first:pl-3 in-first:py-2 cursor-pointer h-full hover:bg-gray-300 transition-all flex justify-center items-center text-gray-700">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                  class="lucide lucide-plus-icon lucide-plus">
                  <path d="M5 12h14" />
                  <path d="M12 5v14" />
                </svg>
              </div>
            </template>
          </InputPopup>
        </div>
      </div>
      <div class="flex items-center gap-2 z-10">
        <div class="flex items-center shrink-0 mr-2">
          <div
            v-for="user in Array.from(collabStore.presence.values()).flat().filter(u => u.userId !== userStore.activeUser?.id)"
            :key="user.userId"
            class="rounded-full aspect-square border-box h-9 flex items-center justify-center shrink-0 border-2 text-sm p-2 -ml-2 bg-white"
            :style="`color: ${getUserColor(user.userId, user.viewing ? 1.0 : 0.1)}; border-color: ${getUserColor(user.userId, user.viewing ? 1.0 : 0.1)}`">
            {{users.find(u => u.id === user.userId)?.name[0] || '?'}}
          </div>
        </div>
        <InputPopup v-model="newComment" @confirm="addComment">f:mlf:ml
          <template #trigger>
            <div
              class="bg-gray-200 rounded-full p-2 px-4 flex items-center gap-2 hover:bg-white transition-all duration-200 ease-out text-gray-700">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                class="lucide lucide-message-square-text-icon lucide-message-square-text">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                <path d="M13 8H7" />
                <path d="M17 12H7" />
              </svg>
            </div>
          </template>
        </InputPopup>
        <label class="flex items-center cursor-pointer relative bg-gray-200 rounded-full p-2 px-4">
          <div class="flex items-center relative">
            <input type="checkbox" v-model="collabStore.isAnnotationMode"
              class="peer h-5 w-5 bg-gray-100 cursor-pointer transition-all appearance-none rounded border border-slate-300 checked:bg-gray-700 checked:border-gray-700"
              id="check" />
            <span
              class="absolute text-white opacity-0 peer-checked:opacity-100 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"
                stroke="currentColor" stroke-width="1">
                <path fill-rule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clip-rule="evenodd"></path>
              </svg>
            </span>
          </div>
          <div class="ml-2">Vorschlagen</div>
        </label>
        <!-- <label class="flex items-center cursor-pointer relative bg-gray-200 rounded-full p-2 px-4">
          <div class="flex items-center relative">
            <input type="checkbox" v-model="collabStore.connection"
              class="peer h-5 w-5 bg-gray-100 cursor-pointer transition-all appearance-none rounded border border-slate-300 checked:bg-gray-700 checked:border-gray-700"
              id="check" />
            <span
              class="absolute text-white opacity-0 peer-checked:opacity-100 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 pointer-events-none">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"
                stroke="currentColor" stroke-width="1">
                <path fill-rule="evenodd"
                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                  clip-rule="evenodd"></path>
              </svg>
            </span>
          </div>
          <div class="ml-2">Online</div>
        </label>  -->
        <div @click="() => {
          collabStore.leaveDocument();
          userStore.logout();
        }"
          class="rounded-full aspect-square border-box h-9 flex items-center justify-center shrink-0 border-2 text-sm p-2 mr-4 bg-white cursor-pointer"
          :style="`color: ${getUserColor(userStore.activeUser!.id)}; border-color: ${getUserColor(userStore.activeUser!.id)}`">
          {{ userStore.activeUser!.name }}
        </div>
      </div>
    </div>
    <div v-if="documentStore.isDocumentLoaded" @scroll="onContainerScroll" ref="container"
      class="flex h-full w-full px-3 pb-4 gap-4 overflow-auto">
      <Editor class="w-full outline-0 transition-all" />
      <div class="flex flex-col gap-3 min-w-48 shrink-0 relative" ref="commentPanel">
        <Annotation v-for="annotation in sortedAnnotations" :key="annotation.id" :annotation="annotation"
          :data-annotation-comment-id="annotation.id"
          :style="{ position: 'absolute', top: annotationPositions[annotation.id] + 'px' }" />
        <div v-if="sortedAnnotations.length === 0" class="flex items-center justify-center h-96">
          <div class="text-gray-500 text-sm text-center">
            Keine Vorschläge vorhanden
          </div>
        </div>
      </div>
    </div>
  </body>
</template>
