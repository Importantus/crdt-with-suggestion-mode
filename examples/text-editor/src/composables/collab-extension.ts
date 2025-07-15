// src/composables/collab-extension.ts

import type { useCollabStore } from '@/stores/collab'
import type { useDocumentStore } from '@/stores/document'
import { Annotation, EditorState, Prec, Range, StateEffect } from '@codemirror/state'
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

// --- 1. Dekorationen für Suggestions ---

const suggestionMarkDelete = Decoration.mark({ class: 'cm-suggestion-delete' })
const suggestionMarkInsert = Decoration.mark({ class: 'cm-suggestion-insert' })

/**
 * Erzeugt ein DecorationSet für alle aktiven Suggestions aus dem DocumentStore.
 * @param docStore - Die Instanz des Document Stores.
 * @param state - Der aktuelle EditorState zur Positionsberechnung.
 * @returns Ein Set von Dekorationen.
 */
function getSuggestionDecorations(
  docStore: ReturnType<typeof useDocumentStore>,
  state: EditorState,
): DecorationSet {
  const decorations: Range<Decoration>[] = []
  if (!docStore.isDocumentLoaded) return Decoration.none

  for (const suggestion of docStore.suggestions.values()) {
    const from = Cursors.toIndex(suggestion.startPosition, docStore.document!.content)
    const to = suggestion.endPosition
      ? Cursors.toIndex(suggestion.endPosition, docStore.document!.content)
      : state.doc.length // Platzhalter

    if (from >= to) continue

    switch (suggestion.description) {
      case SuggestionDescription.DELETE_SUGGESTION:
        decorations.push(suggestionMarkDelete.range(from, to))
        break
      case SuggestionDescription.INSERT_SUGGESTION:
        decorations.push(suggestionMarkInsert.range(from, to))
        break
    }
  }

  return Decoration.set(decorations)
}

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
      private unsubscribeFromDocumentChange?: () => void
      private unsubscribeFromTextChange: (() => void)[] = []

      constructor(private view: EditorView) {
        // Hängt Listener an die Stores, um auf externe Änderungen zu reagieren.
        this.unsubscribeFromDocumentChange = docStore.$onAction(({ name, store, after }) => {
          // Wenn der Store durch eine externe Quelle (nicht CM6) aktualisiert wurde,
          // müssen wir den Editor benachrichtigen.
          if (name === 'setDocument') {
            after(() => this.syncFullDocument(store.textContent))
          }
        })

        setTimeout(() => {
          if (docStore.document) {
            this.syncFullDocument(docStore.textContent)
          }
        })
      }

      addTextChangeListeners() {
        console.log('Adding text change listeners...')
        if (docStore.document) {
          this.unsubscribeFromTextChange.push(
            docStore.document?.content.on('Insert', (i) => {
              const transaction = this.view.state.update({
                changes: { from: i.index, insert: i.values },
                annotations: isProcessedAnnotation.of(true),
                // filter: true,
                selection: { anchor: i.index + 1 },
              })

              console.log('Inserting text')

              this.view.dispatch(transaction)
            }),
          )

          this.unsubscribeFromTextChange.push(
            docStore.document?.content.on('Delete', (d) => {
              const transaction = this.view.state.update({
                changes: { from: d.index, to: d.index + d.values.length },
                annotations: isProcessedAnnotation.of(true),
                // filter: true,
                selection: { anchor: d.index },
              })

              this.view.dispatch(transaction)
            }),
          )
        }
      }

      removeTextChangeListeners() {
        this.unsubscribeFromTextChange.forEach((f) => f())
      }

      update(update: ViewUpdate) {
        // if (update.docChanged) {
        //   update.transactions
        //     .filter((t) => !t.annotation(isProcessedAnnotation))
        //     .flatMap((t) => t.changes)
        //     .forEach((cs) =>
        //       cs.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        //         const deleted = update.startState.doc.sliceString(fromA, toA)
        //         if (deleted.length > 0) {
        //           docStore.deleteText(fromA, deleted.length, collabStore.isSuggestionMode)
        //         }
        //         if (inserted.length > 0) {
        //           docStore.insertText(fromA, inserted.toString(), collabStore.isSuggestionMode)
        //         }
        //       }),
        //     )
        // }
        // // Lokale Selektionsänderungen an den Store senden
        // if (update.selectionSet && docStore.document?.content.length) {
        //   const selection = update.state.selection.main
        //   // Hier müssten die Indizes wieder in Cursor-Objekte umgewandelt werden
        //   collabStore.updateMyPresence({
        //     selection: {
        //       document: docStore.id!,
        //       anchor: Cursors.fromIndex(selection.anchor, docStore.document.content),
        //       head: Cursors.fromIndex(selection.head, docStore.document.content),
        //     },
        //   })
        // }
      }

      /**
       * Ersetzt den gesamten Inhalt des Editors mit dem Text aus dem Store.
       * Dies wird verwendet, wenn das Dokument gewechselt wird oder eine größere
       * externe Änderung stattfindet.
       */
      syncFullDocument(text: string) {
        console.log('Sync full document')

        this.unsubscribeFromTextChange.forEach((f) => f())

        this.view.dispatch({
          changes: {
            from: 0,
            to: this.view.state.doc.length,
            insert: text,
          },
          annotations: isProcessedAnnotation.of(true),
          effects: [refreshDecorationsEffect.of()], // Dekorationen neu zeichnen
        })

        this.addTextChangeListeners()
      }

      destroy() {
        if (this.unsubscribeFromDocumentChange) {
          this.unsubscribeFromDocumentChange()
        }
      }
    },
  )

  /**
   * Ein separates Plugin zur Verwaltung der Dekorationen.
   * Es reagiert auf den `refreshDecorationsEffect`.
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
        const suggestions = getSuggestionDecorations(docStore, state)
        const remoteSelections = getRemoteSelectionDecorations(docStore, collabStore)
        const remoteRanges: Range<Decoration>[] = []
        for (let cursor = remoteSelections.iter(); cursor.value; cursor.next()) {
          remoteRanges.push({
            from: cursor.from,
            to: cursor.to,
            value: cursor.value,
          })
        }
        return suggestions //.update({ add: remoteRanges })
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  )

  /**
   * Ein Theme zur Gestaltung der Dekorationen.
   */
  const customTheme = EditorView.baseTheme({
    '.cm-suggestion-delete': {
      textDecoration: 'line-through',
      backgroundColor: '#ff000033',
    },
    '.cm-suggestion-insert': {
      backgroundColor: '#00ff0033',
    },
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

  return [collabPlugin, decorationsPlugin, customTheme, historyKeymapOverride]
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
