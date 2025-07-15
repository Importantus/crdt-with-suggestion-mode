import { CRuntime } from '@collabs/collabs'
import { TabSyncNetwork } from '@collabs/tab-sync' // Beispiel für ein Netzwerk
import { defineStore } from 'pinia'
import { v4 as uuidv4 } from 'uuid'
import { reactive, ref, shallowRef, watch } from 'vue'

import {
  TrackChangesApplication,
  type DocumentID,
  type PresenceState,
} from 'track-changes-application' // Passe den Pfad an
import { useDocumentStore } from './document'

// Ein einfacher Typ für die Darstellung der Dokumentenliste in der UI
export interface DocumentMeta {
  id: DocumentID
  fileName: string
}

export const useCollabStore = defineStore('collab', () => {
  // --- STATE ---

  /**
   * Die zentrale Instanz der Kollaborations-Anwendung.
   * shallowRef wird verwendet, da die Instanz selbst komplex ist und wir nur auf
   * die Neuzuweisung reagieren müssen, nicht auf interne Änderungen.
   */
  const app = shallowRef<TrackChangesApplication | null>(null)

  /**
   * Gibt an, ob die Kollaborations-Session initialisiert und bereit ist.
   */
  const isReady = ref(false)

  /**
   * Steuert, ob Benutzereingaben als Vorschläge (true) oder
   * direkte Änderungen (false) behandelt werden.
   */
  const isSuggestionMode = ref<boolean>(false)

  /**
   * Die ID des aktuellen Benutzers.
   */
  const currentUserId = ref<string>('')

  /**
   * Eine reaktive Map aller Dokumente in der Session für die UI.
   * Key: DocumentID, Value: DocumentMeta
   */
  const documents = reactive<Map<DocumentID, DocumentMeta>>(new Map())

  /**
   * Eine reaktive Map der Präsenzinformationen aller Benutzer.
   * Key: userId, Value: PresenceState
   */
  const presence = reactive<Map<string, PresenceState>>(new Map())

  /**
   * Die ID des aktuell vom Benutzer ausgewählten Dokuments.
   */
  const activeDocumentId = ref<DocumentID | null>(null)

  // --- ACTIONS ---

  /**
   * Initialisiert die gesamte Kollaborations-Umgebung.
   * Erstellt die Collabs-Laufzeitumgebung, das Netzwerk und die Hauptanwendung.
   * @param docId Eine eindeutige ID für die gesamte Session/das Projekt.
   */
  function initialize(docId: string = 'default-session') {
    const user = uuidv4()
    currentUserId.value = user

    const runtime = new CRuntime()
    const mainApp = runtime.registerCollab('app', (init) => new TrackChangesApplication(init, user))
    app.value = mainApp

    // Netzwerk-Setup (Beispiel mit TabSyncNetwork für lokale Browser-Tab-Synchronisation)
    const tabSync = new TabSyncNetwork()
    tabSync.subscribe(runtime, docId)

    // Event-Listener registrieren, um den Pinia-State zu aktualisieren
    attachEventListeners()

    isReady.value = true
    console.log(`Collab session initialized for user: ${user}`)
  }

  /**
   * Hängt Event-Listener an die Collabs-Instanz, um den reaktiven State zu füttern.
   */
  function attachEventListeners() {
    if (!app.value) return

    // Auf Änderungen in der Dokumentenliste hören
    app.value.documents.on('Set', (event) => {
      const doc = event.value
      documents.set(event.key, { id: doc.id, fileName: doc.fileName.toString() })

      // Auch auf Änderungen des Dateinamens hören
      doc.fileName.on('Any', () => {
        const meta = documents.get(doc.id)
        if (meta) {
          meta.fileName = doc.fileName.toString()
        }
      })
    })

    app.value.documents.on('Delete', (event) => {
      documents.delete(event.key)
      // Wenn das gelöschte Dokument das aktive war, Auswahl zurücksetzen
      if (activeDocumentId.value === event.key) {
        setActiveDocument(null)
      }
    })

    // Auf Präsenz-Änderungen hören
    app.value.presence.on('Set', (event) => {
      presence.set(event.key, event.value)
    })
    app.value.presence.on('Delete', (event) => {
      presence.delete(event.key)
    })
  }

  /**
   * Erstellt ein neues kollaboratives Dokument.
   * @param fileName Der Dateiname für das neue Dokument.
   * @returns Die ID des neu erstellten Dokuments.
   */
  function createDocument(fileName: string): DocumentID {
    if (!app.value) throw new Error('App not initialized.')
    const newDocId = app.value.createDocument(fileName)
    // Das neue Dokument direkt als aktiv setzen
    setActiveDocument(newDocId)
    return newDocId
  }

  /**
   * Löscht ein Dokument aus der Session.
   * @param id Die ID des zu löschenden Dokuments.
   */
  function removeDocument(id: DocumentID) {
    if (!app.value) throw new Error('App not initialized.')
    app.value.removeDocument(id)
  }

  /**
   * Setzt das aktive Dokument.
   * @param id Die ID des Dokuments, das aktiv werden soll, oder null.
   */
  function setActiveDocument(id: DocumentID | null) {
    activeDocumentId.value = id
  }

  /**
   * Schaltet den Vorschlagsmodus um.
   */
  function toggleSuggestionMode() {
    isSuggestionMode.value = !isSuggestionMode.value
    console.log(`Suggestion mode is now: ${isSuggestionMode.value ? 'ON' : 'OFF'}`)
  }

  /**
   * Aktualisiert den Präsenzstatus des aktuellen Benutzers.
   * @param presenceUpdate Ein partielles Update des PresenceState.
   */
  function updateMyPresence(presenceUpdate: Partial<Omit<PresenceState, 'userId'>>) {
    if (!app.value || !app.value.presence.connected) return
    const currentState = app.value.presence.getOurs() || {
      selection: null,
      viewing: true,
    }
    app.value.presence.setOurs({
      ...currentState,
      ...presenceUpdate,
      userId: currentUserId.value,
    })
  }

  // --- LOGIC / WATCHERS ---

  // Verbindet den Collab-Store mit dem Dokument-Store.
  // Wenn sich das aktive Dokument ändert, wird der Dokument-Store informiert.
  const documentStore = useDocumentStore()
  watch(
    activeDocumentId,
    (newId, oldId) => {
      if (newId === oldId) return
      if (!app.value) {
        documentStore.setDocument(null)
        return
      }
      const docInstance = newId ? (app.value.documents.get(newId) ?? null) : null
      documentStore.setDocument(docInstance)
    },
    { flush: 'sync' },
  ) // 'sync' um race conditions beim schnellen Wechsel zu vermeiden

  return {
    isReady,
    currentUserId,
    documents,
    presence,
    activeDocumentId,
    initialize,
    createDocument,
    removeDocument,
    setActiveDocument,
    toggleSuggestionMode,
    isSuggestionMode,
    updateMyPresence,
  }
})
