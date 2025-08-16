/**
 * Written with the help of AI.
 */
import { CRuntime } from '@collabs/collabs'
import { TabSyncNetwork } from '@collabs/tab-sync'
import { defineStore } from 'pinia'
import { reactive, ref, shallowRef, watch } from 'vue'

import {
  TrackChangesApplication,
  type DocumentID,
  type PresenceState,
} from 'track-changes-application'
import { useDocumentStore } from './document'
import { useUserStore } from './user'

// Ein einfacher Typ für die Darstellung der Dokumentenliste in der UI
export interface DocumentMeta {
  id: DocumentID
  fileName: string
}

export const useCollabStore = defineStore('collab', () => {
  // --- STATE ---

  const userStore = useUserStore()

  const docId = 'default-session'
  const runtime = new CRuntime()

  /**
   * Die zentrale Instanz der Kollaborations-Anwendung.
   * shallowRef wird verwendet, da die Instanz selbst komplex ist und wir nur auf
   * die Neuzuweisung reagieren müssen, nicht auf interne Änderungen.
   */
  const app = shallowRef<TrackChangesApplication | null>(null)

  /**
   * Das Netzwerk-Objekt für die Kollaboration.
   * Wird für die Verbindung zwischen verschiedenen Clients verwendet.
   */
  const network = shallowRef<TabSyncNetwork | null>(new TabSyncNetwork())

  /**
   * Gibt an, ob die Kollaborations-Session initialisiert und bereit ist.
   */
  const isReady = ref(false)

  /**
   * Steuert, ob Benutzereingaben als Vorschläge (true) oder
   * direkte Änderungen (false) behandelt werden.
   */
  const isAnnotationMode = ref<boolean>(false)

  /**
   * Replica ID for the current user, used for presence tracking.
   */
  const replicaId = ref<string>('')

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
   * @param docId Eine eindeutige ID für das Projekt.
   */
  function initialize(userId: string) {
    const mainApp = runtime.registerCollab(
      'app',
      (init) => new TrackChangesApplication(init, userId),
    )
    app.value = mainApp

    connection.value = true

    replicaId.value = runtime.replicaID

    // Event-Listener registrieren, um den Pinia-State zu aktualisieren
    attachEventListeners()

    app.value.presence.setOurs({
      userId: userId,
      viewing: true,
      selection: null,
      replicaId: replicaId.value,
    })
    app.value.presence.connect()

    isReady.value = true
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
      presence.set(event.value.replicaId, event.value)
    })
    app.value.presence.on('Delete', (event) => {
      presence.delete(event.value.replicaId)
    })

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        updateMyPresence({
          viewing: false,
        })
      } else if (document.visibilityState === 'visible') {
        updateMyPresence({
          viewing: true,
        })
      }
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
  function toggleAnnotationMode() {
    isAnnotationMode.value = !isAnnotationMode.value
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

    const newState = {
      ...currentState,
      ...presenceUpdate,
    }

    app.value.presence.setOurs({
      ...newState,
      userId: userStore.activeUser?.id || 'unknown-user',
      replicaId: replicaId.value,
    })
  }

  function leaveDocument() {
    if (!app.value) return
    app.value.presence.disconnect()
    app.value = null
    isReady.value = false
    activeDocumentId.value = null
    documents.clear()
    presence.clear()
  }

  // --- COMPUTED ---
  // A connection variable that can be set to true or false an in the background toggles the connection
  const connection = ref<boolean>(false)
  watch(
    connection,
    (newValue) => {
      if (newValue) {
        network.value?.subscribe(runtime, docId)
        app.value?.presence.connect()
      } else {
        app.value?.presence.disconnect()
        network.value?.unsubscribe(runtime)
      }
    },
    { immediate: true },
  )

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
    connection,
    replicaId,
    leaveDocument,
    app,
    isReady,
    documents,
    presence,
    activeDocumentId,
    initialize,
    createDocument,
    removeDocument,
    setActiveDocument,
    toggleAnnotationMode,
    isAnnotationMode,
    updateMyPresence,
  }
})
