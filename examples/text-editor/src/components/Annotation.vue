<script setup lang="ts">
import { useDocumentStore } from '@/stores/document';
import { AnnotationDescription, type Annotation } from 'track-changes-application';
import { AnnotationType } from 'track-changes-crdt';

const props = defineProps<{ annotation: Annotation }>()
const documentStore = useDocumentStore()

function onAnnotationMouseover(id: string) {
  const el = document.querySelector(`*[data-annotation-id="${id}"]`)
  // Set the background color to indicate hover
  if (el) {
    el.classList.add('outline-2', 'outline-blue-500', 'rounded-xs')
  }
}

function onAnnotationMouseOut(id: string) {
  const el = document.querySelector(`*[data-annotation-id="${id}"]`)
  // Remove the background color on mouse out
  if (el) {
    el.classList.remove('outline-2', 'outline-blue-500', 'rounded-xs')
  }
}

function getAnnotationName() {
  switch (props.annotation.description) {
    case AnnotationDescription.ADD_COMMENT:
      return 'Kommentar'
    case AnnotationDescription.INSERT_SUGGESTION:
      return 'Hinzufügung'
    case AnnotationDescription.DELETE_SUGGESTION:
      return 'Löschung'
    default:
      return 'Unbekannt'
  }
}

function getAnnotationText() {
  switch (props.annotation.description) {
    case AnnotationDescription.ADD_COMMENT:
      return props.annotation.value
    case AnnotationDescription.INSERT_SUGGESTION:
      return ''
    case AnnotationDescription.DELETE_SUGGESTION:
      return ''
    default:
      return ''
  }
}
</script>

<template>
  <div
    class="flex justify-between p-3 bg-gray-200 rounded-lg gap-3 hover:bg-white hover:shadow transition-all duration-200 ease-out hover:scale-[101%]"
    @mouseover="onAnnotationMouseover(annotation.id)" @mouseleave="onAnnotationMouseOut(annotation.id)">
    <div class="flex flex-col justify-center">
      <h3 class="text-sm font-medium">
        {{ getAnnotationName() }}
      </h3>
      <p class="text-sm text-gray-600">
        {{ getAnnotationText() }}
      </p>
    </div>
    <div class="flex rounded-full overflow-hidden bg-gray-300 h-fit text-sm text-gray-700">
      <button @click="
        () => {
          if (annotation.type === AnnotationType.SUGGESTION) {
            documentStore.acceptSuggestion(annotation.id)
          } else {
            documentStore.removeComment(annotation.id)
          }
        }
      " class="cursor-pointer last:px-2 last:py-1 p-1 hover:bg-gray-100 transition-all">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          class="lucide lucide-check-icon lucide-check">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </button>
      <button v-if="annotation.type === AnnotationType.SUGGESTION"
        @click="documentStore.declineSuggestion(annotation.id)"
        class="cursor-pointer hover:bg-gray-100 p-1 transition-all">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          class="lucide lucide-x-icon lucide-x">
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </div>
  </div>
</template>
