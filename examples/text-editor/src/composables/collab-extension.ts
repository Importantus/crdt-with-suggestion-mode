// src/composables/collab-extension.ts

import type { useCollabStore } from '@/stores/collab'
import type { useDocumentStore } from '@/stores/document'
import { Annotation, EditorState, Prec, Range, StateEffect, StateField } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import { Cursors } from '@collabs/collabs'
import { SuggestionDescription } from 'track-changes-application'

export const isProcessedAnnotation = Annotation.define<boolean>()

/**
 * Ein StateEffect, der signalisiert, dass Dekorationen (Suggestions, Cursors)
 * neu berechnet und gezeichnet werden müssen, weil sich der zugrundeliegende
 * Store-State geändert hat.
 */
const refreshDecorationsEffect = StateEffect.define<void>()

// --- 1. Dekorationen für Suggestions (mit StateField) ---

const suggestionMarkDelete = Decoration.mark({ class: 'cm-suggestion-delete' })
const suggestionMarkInsert = Decoration.mark({ class: 'cm-suggestion-insert' })

/**
 * Definiert einen StateEffect zum Hinzufügen einer Vorschlagsdekoration.
 * Die Nutzlast enthält alle notwendigen Informationen.
 */
const addSuggestionEffect = StateEffect.define<{
  from: number
  to: number
  description: SuggestionDescription
  endClosed: boolean
}>({
  map: ({ from, to, endClosed, ...rest }, change) => ({
    from: change.mapPos(from),
    to: change.mapPos(endClosed ? to + 1 : to),
    endClosed,
    ...rest,
  }),
})

/**
 * Definiert einen StateEffect zum Entfernen von Vorschlagsdekorationen in einem bestimmten Bereich.
 */
const removeSuggestionEffect = StateEffect.define<{ from: number; to: number }>()

/**
 * Ein StateField, das die DecorationSet für alle Vorschläge verwaltet.
 * Dies ist analog zum `underlineField` aus dem Beispiel.
 */
const suggestionField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(suggestions, tr) {
    // Positionen an die Änderungen in der Transaktion anpassen
    suggestions = suggestions.map(tr.changes)

    // Effekte verarbeiten
    for (const effect of tr.effects) {
      if (effect.is(addSuggestionEffect)) {
        const { from, to, description } = effect.value
        console.log('Adding suggestion:', description, from, to)
        if (from >= to) continue

        const mark =
          description === SuggestionDescription.DELETE_SUGGESTION
            ? suggestionMarkDelete
            : suggestionMarkInsert
        suggestions = suggestions.update({
          add: [mark.range(from, to)],
        })
      } else if (effect.is(removeSuggestionEffect)) {
        const { from, to } = effect.value
        console.log('Removing suggestion from', from, 'to', to)
        suggestions = suggestions.update({
          filter: (f, t) => f < from || t > to,
        })
      }
    }
    return suggestions
  },
  provide: (f) => EditorView.decorations.from(f),
})

// --- 2. Dekorationen für Remote-Cursors ---

class RemoteCursorWidget extends WidgetType {
  constructor(
    readonly userName: string,
    readonly color: string,
  ) {
    super()
  }

  eq(other: RemoteCursorWidget) {
    return other.userName === this.userName && other.color === this.color
  }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-remote-cursor'
    span.style.backgroundColor = this.color
    span.textContent = this.userName
    return span
  }
}

function getRemoteSelectionDecorations(
  docStore: ReturnType<typeof useDocumentStore>,
  collabStore: ReturnType<typeof useCollabStore>,
): DecorationSet {
  const decorations: Range<Decoration>[] = []
  const users = Array.from(collabStore.presence.values())

  for (const user of users) {
    // Ignoriere den aktuellen Benutzer und inaktive Benutzer
    if (user.userId === collabStore.currentUserId || !user.viewing || !user.selection) continue

    const { anchor, head } = user.selection
    const anchorPos = Cursors.toIndex(anchor, docStore.document!.content)
    const headPos = Cursors.toIndex(head, docStore.document!.content)

    const color = getUserColor(user.userId) // Helper-Funktion zur Farberzeugung
    const cursorWidget = Decoration.widget({
      widget: new RemoteCursorWidget(user.userId.substring(0, 5), color),
      side: headPos > anchorPos ? 1 : -1,
    })

    decorations.push(
      Decoration.mark({
        class: 'cm-remote-selection',
        attributes: { style: `background-color: ${color}33` }, // semi-transparent
      }).range(anchorPos, headPos),
      cursorWidget.range(headPos),
    )
  }

  return Decoration.set(decorations)
}

// --- 3. Das zentrale ViewPlugin für die Zwei-Wege-Synchronisation ---

/**
 * Erstellt die Kern-Extension für die Kollaboration.
 * @param docStore - Die Instanz des Document Stores.
 * @param collabStore - Die Instanz des Collab Stores.
 */
export function createCollabExtension(
  docStore: ReturnType<typeof useDocumentStore>,
  collabStore: ReturnType<typeof useCollabStore>,
) {
  /**
   * Ein ViewPlugin, das die gesamte Kommunikation zwischen den Stores und CM6 steuert.
   */
  const collabPlugin = ViewPlugin.fromClass(
    class {
      private unsubscribeFromCollabChange: (() => void)[] = []
      private unsubscribeFromDocumentChange: (() => void)[] = []

      constructor(private view: EditorView) {
        // Hängt Listener an die Stores, um auf externe Änderungen zu reagieren.
        this.unsubscribeFromCollabChange.push(
          docStore.$onAction(({ name, store, after }) => {
            // Wenn der Store durch eine externe Quelle (nicht CM6) aktualisiert wurde,
            // müssen wir den Editor benachrichtigen.
            if (name === 'setDocument') {
              after(() => this.syncFullDocument(store.textContent))
            }
          }),
        )

        setTimeout(() => {
          if (docStore.document) {
            this.syncFullDocument(docStore.textContent)
          }
        })
      }

      addSuggestionChangeListener() {
        if (docStore.document) {
          this.unsubscribeFromDocumentChange.push(
            docStore.document.content.on('SuggestionAdded', (event) => {
              this.view.dispatch({
                selection:
                  event.meta.isLocalOp &&
                  event.suggestion.description === SuggestionDescription.DELETE_SUGGESTION
                    ? { anchor: event.startIndex }
                    : undefined,
                effects: addSuggestionEffect.of({
                  from: event.startIndex,
                  to: event.endIndex,
                  description: event.suggestion.description,
                  endClosed: event.suggestion.endClosed ?? false,
                }),
              })
            }),
          )

          this.unsubscribeFromDocumentChange.push(
            docStore.document.content.on('SuggestionRemoved', (event) => {
              this.view.dispatch({
                effects: removeSuggestionEffect.of({ from: event.startIndex, to: event.endIndex }),
              })
            }),
          )
        }
      }

      addTextChangeListeners() {
        console.log('Adding text change listeners...')
        if (docStore.document) {
          this.unsubscribeFromDocumentChange.push(
            docStore.document?.content.on('Insert', (i) => {
              const transaction = this.view.state.update({
                changes: { from: i.index, insert: i.values },
                annotations: isProcessedAnnotation.of(true),
                selection: i.meta.isLocalOp ? { anchor: i.index + 1 } : undefined,
                effects: i.suggestions?.map((s) =>
                  addSuggestionEffect.of({
                    from: i.index,
                    to: i.index + i.values.length,
                    description: s.description,
                    endClosed: s.endClosed ?? false,
                  }),
                ),
              })

              this.view.dispatch(transaction)
            }),
          )

          this.unsubscribeFromDocumentChange.push(
            docStore.document?.content.on('Delete', (d) => {
              const transaction = this.view.state.update({
                changes: { from: d.index, to: d.index + d.values.length },
                annotations: isProcessedAnnotation.of(true),
                selection: d.meta.isLocalOp ? { anchor: d.index } : undefined,
              })

              this.view.dispatch(transaction)
            }),
          )
        }
      }

      removeTextChangeListeners() {
        this.unsubscribeFromDocumentChange.forEach((f) => f())
      }

      /**
       * Ersetzt den gesamten Inhalt des Editors mit dem Text aus dem Store.
       * Dies wird verwendet, wenn das Dokument gewechselt wird oder eine größere
       * externe Änderung stattfindet.
       */
      syncFullDocument(text: string) {
        console.log('Sync full document')

        this.unsubscribeFromDocumentChange.forEach((f) => f())

        const effects: StateEffect<unknown>[] = []

        if (!this.view.state.field(suggestionField, false)) {
          effects.push(StateEffect.appendConfig.of([suggestionField, suggestionTheme]))
        }

        docStore.suggestions.forEach((suggestion) => {
          effects.push(
            addSuggestionEffect.of({
              from: suggestion.startIndex,
              to: suggestion.endIndex,
              description: suggestion.suggestion.description,
              endClosed: suggestion.suggestion.endClosed ?? false,
            }),
          )
        })

        this.view.dispatch({
          changes: {
            from: 0,
            to: this.view.state.doc.length,
            insert: text,
          },
          annotations: isProcessedAnnotation.of(true),
          effects: effects,
        })

        this.addTextChangeListeners()
        this.addSuggestionChangeListener()
      }

      destroy() {
        if (this.unsubscribeFromCollabChange) {
          this.unsubscribeFromCollabChange.forEach((f) => f())
        }
      }
    },
  )

  /**
   * Ein separates Plugin zur Verwaltung der Cursor-Dekorationen.
   * Die Vorschläge werden jetzt durch das suggestionField verwaltet.
   */
  const decorationsPlugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = this.computeDecorations(view.state)
      }

      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.viewportChanged ||
          update.transactions.some((tr) => tr.effects.some((e) => e.is(refreshDecorationsEffect)))
        ) {
          this.decorations = this.computeDecorations(update.state)
        }
      }

      private computeDecorations(state: EditorState): DecorationSet {
        // Nur noch die Cursors/Selections berechnen
        return getRemoteSelectionDecorations(docStore, collabStore)
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  )

  /**
   * Ein Theme zur Gestaltung der Dekorationen.
   * Umbenannt, um Verwechslungen zu vermeiden.
   */
  const suggestionTheme = EditorView.baseTheme({
    '.cm-suggestion-delete': {
      textDecoration: 'line-through',
      backgroundColor: '#ff000033',
    },
    '.cm-suggestion-insert': {
      backgroundColor: '#00ff0033',
    },
  })

  const remoteCursorTheme = EditorView.baseTheme({
    '.cm-remote-selection': {
      // Stil wird inline gesetzt
    },
    '.cm-remote-cursor': {
      position: 'relative',
      borderLeft: '2px solid black',
      borderRight: '2px solid black',
      marginLeft: '-1px',
      marginRight: '-1px',
      boxSizing: 'border-box',
      color: 'white',
      padding: '0 4px',
      borderRadius: '3px',
    },
  })

  /**
   * Deaktiviert die eingebaute Undo/Redo-Funktionalität, da unser
   * CRDT-Framework den State verwaltet.
   */
  const historyKeymapOverride = Prec.high(
    keymap.of([
      { key: 'Mod-z', run: () => true }, // "true" zurückgeben, um die weitere Verarbeitung zu stoppen
      { key: 'Mod-y', run: () => true },
      { key: 'Mod-Shift-z', run: () => true },
    ]),
  )

  // Die Extension-Liste muss nun das suggestionField enthalten
  return [
    collabPlugin,
    suggestionField, // Das neue StateField für Suggestions
    decorationsPlugin, // Plugin nur noch für Cursors
    suggestionTheme, // Theme für Suggestions
    remoteCursorTheme, // Theme für Cursors
    historyKeymapOverride,
  ]
}

/**
 * Erzeugt eine konsistente Farbe für eine gegebene User-ID.
 */
function getUserColor(userId: string): string {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash)
  }
  const c = (hash & 0x00ffffff).toString(16).toUpperCase()
  return '#' + '00000'.substring(0, 6 - c.length) + c
}
