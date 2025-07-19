import { Annotation, EditorState } from '@codemirror/state'
import { EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view'
import type { TrackChangesDocument } from 'track-changes-application'
import { dynamicFlagsField } from './collab'
import { TrackChangesConfig, trackChangesFacet } from './collab-config'

// An annotation to mark transactions that originate from our CRDT.
// This prevents infinite loops.
const crdtTransaction = Annotation.define<boolean>()

import { StateEffect } from '@codemirror/state'

interface CRDTUpdate {
  type: 'insert' | 'delete'
  from: number
  to?: number // Only for delete
  text?: string // Only for insert
  isSuggestion: boolean
}

export const crdtUpdateEffect = StateEffect.define<CRDTUpdate>()

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
    const isSuggestion = tr.state.field(dynamicFlagsField).suggestionMode
    const effects: StateEffect<any>[] = []
    let isDeletion = false

    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      const text = inserted.sliceString(0)
      if (toA > fromA) {
        isDeletion = true
        // Deletion
        effects.push(
          crdtUpdateEffect.of({
            type: 'delete',
            from: fromA,
            to: toA,
            isSuggestion,
          }),
        )
      }
      if (text.length > 0) {
        // Insertion
        effects.push(
          crdtUpdateEffect.of({
            type: 'insert',
            from: fromA,
            text,
            isSuggestion,
          }),
        )
      }
    })

    // Replace the original transaction with one that only updates the selection.
    // The actual text change will come later via the CRDT event.
    return {
      changes: [],
      effects: [...tr.effects, ...effects],
      selection: isDeletion ? tr.selection : undefined,
      sequential: true,
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
    private config: TrackChangesConfig

    private unsubscribe: (() => void)[] = []

    constructor(view: EditorView) {
      this.view = view
      this.config = view.state.facet(trackChangesFacet)
      this.docContent = this.config.doc.content
      this.attachEventListeners()
    }

    update(update: ViewUpdate) {
      for (const tr of update.transactions) {
        for (const effect of tr.effects) {
          if (effect.is(crdtUpdateEffect)) {
            const crdtUpdate = effect.value
            if (crdtUpdate.type === 'insert' && crdtUpdate.text) {
              this.config.doc.content.insert(
                crdtUpdate.from,
                crdtUpdate.text,
                crdtUpdate.isSuggestion,
              )
            } else if (crdtUpdate.type === 'delete' && crdtUpdate.to) {
              const length = crdtUpdate.to - crdtUpdate.from
              this.config.doc.content.delete(crdtUpdate.from, length, crdtUpdate.isSuggestion)
            }
          }
        }
      }
    }

    attachEventListeners() {
      // Listen to insert events
      this.unsubscribe.push(
        this.docContent.on('Insert', (event) => {
          setTimeout(() => {
            this.view.dispatch({
              changes: { from: event.index, insert: event.values },
              selection: event.meta.isLocalOp ? { anchor: event.index + 1 } : undefined,
              annotations: [crdtTransaction.of(true)],
            })
          })
        }),
      )

      // Listen to delete events
      this.unsubscribe.push(
        this.docContent.on('Delete', (event) => {
          setTimeout(() => {
            console.log('Delete event:', event)
            this.view.dispatch({
              changes: { from: event.index, to: event.index + event.values.length },
              selection: event.meta.isLocalOp ? { anchor: event.index } : undefined,
              annotations: [crdtTransaction.of(true)],
            })
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
