import { Annotation, EditorState } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import type { TrackChangesDocument } from 'track-changes-application'
import { dynamicFlagsField } from './collab'
import { trackChangesFacet } from './collab-config'

// An annotation to mark transactions that originate from our CRDT.
// This prevents infinite loops.
const crdtTransaction = Annotation.define<boolean>()

/**
 * transactionFilter that intercepts user input and forwards it to the CRDT library.
 */
export const collabInputHandler = EditorState.transactionFilter.of((tr) => {
  // Ignore transactions that come from our CRDT plugin
  if (tr.annotation(crdtTransaction)) {
    return tr
  }

  // Check if it’s a user text change
  if ((tr.docChanged && tr.isUserEvent('input')) || tr.isUserEvent('delete')) {
    const config = tr.state.facet(trackChangesFacet)
    const isSuggestion = tr.state.field(dynamicFlagsField).suggestionMode

    let isDeletion = false

    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      const text = inserted.sliceString(0)
      if (toA > fromA) {
        // Deletion
        isDeletion = true
        setTimeout(() => {
          config.doc.content.delete(fromA, toA - fromA, isSuggestion)
        })
      }
      if (text.length > 0) {
        // Insertion
        setTimeout(() => {
          config.doc.content.insert(fromA, text, isSuggestion)
        })
      }
    })

    // Replace the original transaction with one that only updates the selection.
    // The actual text change will come later via the CRDT event.
    return {
      effects: tr.effects,
      selection: isDeletion ? tr.selection : undefined,
    }
  }

  return tr
})

/**
 * ViewPlugin that listens to events from the CRDT library and updates the editor.
 */
export const collabSync = ViewPlugin.fromClass(
  class {
    private view: EditorView
    private docContent: TrackChangesDocument['content']

    private unsubscribe: (() => void)[] = []

    constructor(view: EditorView) {
      this.view = view
      const config = view.state.facet(trackChangesFacet)
      this.docContent = config.doc.content
      this.attachEventListeners()
    }

    attachEventListeners() {
      // Listen to insert events
      this.unsubscribe.push(
        this.docContent.on('Insert', (event) => {
          this.view.dispatch({
            changes: { from: event.index, insert: event.values },
            selection: event.meta.isLocalOp ? { anchor: event.index + 1 } : undefined,
            annotations: [crdtTransaction.of(true)],
          })
        }),
      )

      // Listen to delete events
      this.unsubscribe.push(
        this.docContent.on('Delete', (event) => {
          this.view.dispatch({
            changes: { from: event.index, to: event.index + event.values.length },
            selection: event.meta.isLocalOp ? { anchor: event.index } : undefined,
            annotations: [crdtTransaction.of(true)],
          })
        }),
      )
    }

    destroy() {
      // Remove all event listeners
      this.unsubscribe.forEach((cleanup) => cleanup())
    }
  },
)
