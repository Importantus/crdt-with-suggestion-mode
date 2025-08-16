/**
 * Written with the help of AI.
 */
import { defineStore } from 'pinia'
import {
  TrackChangesDocument,
  type Annotation,
  type AnnotationId,
  type DocumentID,
} from 'track-changes-application'
import type { AdditionAnnotation } from 'track-changes-crdt/build/esm/c_annotation'
import { computed, reactive, ref, shallowRef } from 'vue'

// Ein Array, um die "unsubscribe"-Funktionen der Event-Listener zu speichern.
type CleanupCallback = () => void
let listenerCleanups: CleanupCallback[] = []

export const useDocumentStore = defineStore('document', () => {
  // --- STATE ---

  /**
   * Die Instanz des aktuell aktiven Dokuments.
   * Wird von useCollabStore gesetzt.
   */
  const document = shallowRef<TrackChangesDocument | null>(null)

  /**
   * Der Dateiname des aktiven Dokuments.
   */
  const fileName = ref<string>('')

  /**
   * Eine reaktive Map aller aktiven Vorschläge (Annotations) im Dokument.
   * Key: AnnotationId, Value: AdditionAnnotation
   */
  const annotations = reactive<Map<AnnotationId, AdditionAnnotation>>(new Map())

  // --- COMPUTED ---
  const id = computed<DocumentID | null>(() => document.value?.id ?? null)
  const isDocumentLoaded = computed<boolean>(() => !!document.value)

  // --- ACTIONS ---

  /**
   * Diese Kernfunktion wird vom useCollabStore aufgerufen, um den Store auf ein
   * neues Dokument auszurichten. Sie räumt alte Listener auf und richtet neue ein.
   * @param newDoc Die neue Dokumenteninstanz oder null.
   */
  function setDocument(newDoc: TrackChangesDocument | null) {
    // 1. Alte Listener entfernen, um Memory-Leaks zu verhindern
    listenerCleanups.forEach((cleanup) => cleanup())
    listenerCleanups = []

    document.value = newDoc

    // 2. State zurücksetzen, wenn kein Dokument geladen ist
    if (!newDoc) {
      fileName.value = ''
      annotations.clear()
      return
    }

    // 3. State mit den Werten des neuen Dokuments initialisieren
    fileName.value = newDoc.fileName.toString()
    annotations.clear()
    newDoc.content.getActiveAnnotations().forEach((item) => {
      annotations.set(item.id, item)
    })

    // 4. Neue Listener für das neue Dokument einrichten
    const onFileNameChange = () => {
      fileName.value = newDoc.fileName.toString()
    }
    const onAnnotationRemoved = (event: { annotation: Annotation }) => {
      console.log('Annotation removed')
      annotations.delete(event.annotation.id)
    }
    // Wir könnten auch auf FormatChange hören, um die Darstellung zu aktualisieren.
    listenerCleanups.push(
      newDoc.fileName.on('Any', onFileNameChange),
      newDoc.content.on('AnnotationAdded', (event) => {
        annotations.set(event.annotation.id, event.annotation)
      }),
      newDoc.content.on('AnnotationRemoved', onAnnotationRemoved),
    )
  }

  function acceptSuggestion(id: AnnotationId) {
    if (!document.value || !annotations.get(id)) return
    document.value.content.acceptSuggestion(id)
  }

  function declineSuggestion(id: AnnotationId) {
    if (!document.value || !annotations.get(id)) return
    document.value.content.declineSuggestion(id)
  }

  function addComment(startIndex: number, endIndex: number, comment: string) {
    if (!document.value) return
    document.value.content.addComment(startIndex, endIndex, comment)
  }

  function removeComment(id: AnnotationId) {
    if (!document.value || !annotations.get(id)) return
    document.value.content.removeComment(id)
  }

  return {
    id,
    document,
    isDocumentLoaded,
    fileName,
    annotations,
    setDocument,
    acceptSuggestion,
    declineSuggestion,
    addComment,
    removeComment,
  }
})
