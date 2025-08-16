<script setup lang="ts">
import { useDocumentStore } from '@/stores/document';
import { users } from '@/stores/user';
import { AnnotationDescription } from 'track-changes-application';
import { AnnotationType } from 'track-changes-crdt';
import type { AdditionAnnotation } from 'track-changes-crdt/build/esm/c_annotation';
// import { onMounted, onUnmounted, ref } from 'vue';

const props = defineProps<{ annotation: AdditionAnnotation }>()
const documentStore = useDocumentStore()

// const text = ref<string>('')
// const lastStartIndex = ref<number>(-1)
// const lastEndIndex = ref<number>(-1)

// const unsubscribe: ((() => void) | undefined)[] = []

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

// function getAnnotationText() {
//   if (props.annotation.type === AnnotationType.COMMENT) {
//     text.value = props.annotation.value || '';
//   } else {
//     const content = documentStore.document!.content
//     const startPosition = props.annotation.startPosition
//     let startIndex = startPosition
//       ? content.indexOfPosition(startPosition, 'left')
//       : -1;

//     const endPosition = props.annotation.endPosition
//     let endIndex = endPosition
//       ? content.indexOfPosition(endPosition, 'right')
//       : content.length;

//     const startCheckIndex = props.annotation.startPosition
//       ? content.indexOfPosition(props.annotation.startPosition, "right")
//       : 0;

//     const endCheckIndex = props.annotation.endPosition
//       ? content.indexOfPosition(props.annotation.endPosition, "left")
//       : content.length;

//     // Extend range if the annotation end is closed
//     if (
//       props.annotation.endClosed &&
//       endIndex < con    :class="{ 'flex': text.length > 0, 'hidden': text.length === 0 }"tent.length &&
//       endCheckIndex === endIndex // Only extend if the end is closed and the real end position is not already deleted
//     ) {
//       endIndex += 1;
//     }

//     // Reduce range if the start is open
//     if (
//       props.annotation.startClosed === false ||
//       startCheckIndex !== startIndex // If the start is closed and the real start position is already deleted, we also need to reduce the range
//     ) {
//       startIndex += 1;
//     }

//     lastStartIndex.value = startIndex;
//     lastEndIndex.value = endIndex;

//     if (startIndex < endIndex) {
//       text.value = content.slice(startIndex, endIndex);
//     } else {
//       text.value = '';
//     }
//   }
// }

// onMounted(() => {
//   getAnnotationText();

//   unsubscribe.push(documentStore.document?.content.on('Insert', (e) => {
//     if (e.index + e.values.length <= lastEndIndex.value + 1) {
//       getAnnotationText();
//     }
//   }))

//   unsubscribe.push(documentStore.document?.content.on('Delete', (e) => {
//     if (e.index + e.values.length < lastEndIndex.value + 1) {
//       getAnnotationText();
//     }
//   }))
// });

// onUnmounted(() => {
//   unsubscribe.forEach((fn) => fn && fn());
// });
</script>

<template>
  <div
    class="flex flex-col p-3 bg-gray-200 rounded-lg gap-3 hover:bg-white hover:shadow transition-all duration-200 ease-out hover:scale-[101%] w-full group"
    @mouseover="onAnnotationMouseover(annotation.id)" @mouseleave="onAnnotationMouseOut(annotation.id)">
    <div class="flex items-center gap-2 justify-between border-b border-gray-300 pb-2">
      <div>
        <h3 class="text-xs">{{users.find(u => u.id === annotation.userId)?.name}}</h3>
        <p class="text-xs text-gray-500">
          {{ new Date(annotation.timestamp).toLocaleTimeString() }}
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

    <div class="flex flex-col justify-center">
      <h3 class="text-xs font-medium">
        {{ getAnnotationName() }}
      </h3>
      <p class="text-xs text-gray-600">
        {{ getAnnotationText() }}
      </p>
    </div>
  </div>
</template>
