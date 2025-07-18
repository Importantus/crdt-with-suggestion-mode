/**
 * Written with the help of AI.
 */
import { defineStore } from 'pinia'
import {
  TrackChangesDocument,
  type DocumentID,
  type Suggestion,
  type SuggestionId,
} from 'track-changes-application'
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
   * Der reine Textinhalt des Dokuments.
   * An dieser Stelle würde ein Texteditor-Framework (z.B. ProseMirror, TipTap)
   * ansetzen, um einen reichhaltigeren Dokumentenzustand zu verwalten.
   * Für eine einfache Demo ist ein String ausreichend.
   */
  const textContent = ref<string>('')

  /**
   * Eine reaktive Map aller aktiven Vorschläge (Suggestions) im Dokument.
   * Key: SuggestionId, Value: Suggestion
   */
  const suggestions = reactive<Map<SuggestionId, Suggestion>>(new Map())

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
      textContent.value = ''
      suggestions.clear()
      return
    }

    // 3. State mit den Werten des neuen Dokuments initialisieren
    fileName.value = newDoc.fileName.toString()
    textContent.value = newDoc.content.toString()
    suggestions.clear()
    newDoc.content.getActiveSuggestions().forEach((item) => {
      suggestions.set(item.id, item)
    })

    // 4. Neue Listener für das neue Dokument einrichten
    const onFileNameChange = () => {
      fileName.value = newDoc.fileName.toString()
    }
    const onTextInsert = () => {
      textContent.value = newDoc.content.toString()
    }
    const onTextDelete = () => {
      textContent.value = newDoc.content.toString()
    }
    const onSuggestionRemoved = (event: { suggestion: Suggestion }) => {
      console.log('Suggestion removed')
      suggestions.delete(event.suggestion.id)
    }
    // Wir könnten auch auf FormatChange hören, um die Darstellung zu aktualisieren.
    listenerCleanups.push(
      newDoc.fileName.on('Any', onFileNameChange),
      newDoc.content.on('Insert', onTextInsert),
      newDoc.content.on('Delete', onTextDelete),
      newDoc.content.on('SuggestionAdded', (event) => {
        suggestions.set(event.suggestion.id, event.suggestion)
      }),
      newDoc.content.on('SuggestionRemoved', onSuggestionRemoved),
    )
  }

  // --- SCHNITTSTELLE FÜR DEN TEXTEDITOR ---
  // Diese Funktionen kapseln die Logik deiner Bibliothek und bieten eine
  // einfache API für die UI-Komponenten.

  function insertText(index: number, text: string, isSuggestion: boolean) {
    if (!document.value) return
    document.value.content.insert(index, text, isSuggestion)
  }

  function deleteText(index: number, count: number, isSuggestion: boolean) {
    if (!document.value) return
    document.value.content.delete(index, count, isSuggestion)
  }

  function acceptSuggestion(id: SuggestionId) {
    if (!document.value || !suggestions.get(id)) return
    document.value.content.acceptSuggestion(suggestions.get(id)!.startPosition, id)
  }

  function declineSuggestion(id: SuggestionId) {
    if (!document.value || !suggestions.get(id)) return
    document.value.content.declineSuggestion(suggestions.get(id)!.startPosition, id)
  }

  function addComment(startIndex: number, endIndex: number, comment: string) {
    if (!document.value) return
    document.value.content.addComment(startIndex, endIndex, comment)
  }

  function removeComment(id: SuggestionId) {
    if (!document.value || !suggestions.get(id)) return
    document.value.content.removeComment(suggestions.get(id)!.startPosition, id)
  }

  return {
    id,
    document,
    isDocumentLoaded,
    fileName,
    textContent,
    suggestions,
    setDocument,
    insertText,
    deleteText,
    acceptSuggestion,
    declineSuggestion,
    addComment,
    removeComment,
  }
})
