import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view'
import { type Position } from '@collabs/collabs'
import { type Suggestion, SuggestionDescription, type SuggestionId } from 'track-changes-crdt'
import { trackChangesFacet } from './collab-config'

const suggestionInsertClass = 'cm-suggestion-insert'
const suggestionDeleteClass = 'cm-suggestion-delete'
const commentClass = 'cm-comment-range'

/**
 * Converts a Suggestion object into a CodeMirror Decoration.
 * Applies a CSS class and data attribute based on suggestion type.
 *
 * @param suggestion - The suggestion metadata including id and description.
 * @returns A Decoration marking the suggested range in the editor.
 */
function suggestionToDecoration(suggestion: Suggestion): Decoration {
  let className = ''
  switch (suggestion.description) {
    case SuggestionDescription.INSERT_SUGGESTION:
      className = suggestionInsertClass
      break
    case SuggestionDescription.DELETE_SUGGESTION:
      className = suggestionDeleteClass
      break
    case SuggestionDescription.ADD_COMMENT:
      className = commentClass
      break
  }
  return Decoration.mark({
    class: className,
    attributes: { 'data-suggestion-id': suggestion.id },
  })
}

/**
 * A CodeMirror ViewPlugin that tracks active suggestions and updates decorations accordingly.
 * Stores suggestions by position rather than index to handle collaborative edits.
 */
export const trackChangesDecorations = ViewPlugin.fromClass(
  class {
    /** Current set of decorations applied to the editor. */
    decorations: DecorationSet = Decoration.none

    /**
     * Map of active suggestions keyed by suggestion ID.
     * Each entry holds the suggestion data and its start/end positions.
     */
    private activeSuggestions = new Map<
      SuggestionId,
      { suggestion: Suggestion; startPos: Position; endPos: Position | null }
    >()

    /**
     * Initializes the plugin: loads existing suggestions and subscribes to updates.
     * @param view - The EditorView instance this plugin is attached to.
     */
    constructor(view: EditorView) {
      const config = view.state.facet(trackChangesFacet)

      // Subscribe to addition of new suggestions
      config.doc.content.on('SuggestionAdded', (event) => {
        const { suggestion } = event
        this.activeSuggestions.set(suggestion.id, {
          suggestion,
          startPos: suggestion.startPosition,
          endPos: suggestion.endPosition,
        })
        // Schedule decoration update asynchronously
        setTimeout(() => {
          this.updateDecorations(view)
        })
      })

      // Subscribe to removal of suggestions
      config.doc.content.on('SuggestionRemoved', (event) => {
        this.activeSuggestions.delete(event.suggestion.id)
        setTimeout(() => {
          this.updateDecorations(view)
        })
      })

      // Initialize map with pre-existing active suggestions
      this.activeSuggestions = config.doc.content.getActiveSuggestions().reduce((map, item) => {
        map.set(item.id, {
          suggestion: item,
          startPos: item.startPosition,
          endPos: item.endPosition,
        })
        return map
      }, new Map<SuggestionId, { suggestion: Suggestion; startPos: Position; endPos: Position | null }>())

      // Initial render of decorations
      setTimeout(() => {
        this.updateDecorations(view)
      })
    }

    /**
     * Reacts to document or viewport changes by recalculating decorations.
     * @param update - The ViewUpdate containing change details.
     */
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        setTimeout(() => {
          this.updateDecorations(update.view)
        })
      }
    }

    /**
     * Computes and applies decorations for all active suggestions.
     * Translates stored positions to current document indices.
     * @param view - The EditorView used to dispatch decoration updates.
     */
    updateDecorations(view: EditorView) {
      const config = view.state.facet(trackChangesFacet)
      const content = config.doc.content
      const decorations = []

      for (const item of this.activeSuggestions.values()) {
        const startIndex = content.indexOfPosition(item.startPos, 'left')
        if (startIndex === -1) continue // Skip if position no longer valid

        let endIndex = item.endPos ? content.indexOfPosition(item.endPos, 'right') : content.length
        if (endIndex === -1) continue

        // Extend range if the suggestion end is closed
        if (item.suggestion.endClosed && endIndex < content.length) {
          endIndex += 1
        }

        if (startIndex < endIndex) {
          decorations.push(suggestionToDecoration(item.suggestion).range(startIndex, endIndex))
        }
      }

      // Update the decoration set and force a redraw
      this.decorations = Decoration.set(decorations, true)
      view.dispatch({ effects: [] })
    }
  },
  {
    decorations: (v) => v.decorations,
  },
)

/**
 * Defines CSS styles for suggestion highlights and comments in the editor.
 * Uses a light background and underline/strikethrough to indicate changes.
 */
export const trackChangesTheme = EditorView.baseTheme({
  [`& .${suggestionInsertClass}`]: {
    backgroundColor: 'rgba(0, 255, 0, 0.2)',
    textDecoration: 'underline solid #0a0 2px',
  },
  [`& .${suggestionDeleteClass}`]: {
    backgroundColor: 'rgba(255, 0, 0, 0.2)',
    textDecoration: 'line-through solid #a00 2px',
  },
  [`& .${commentClass}`]: {
    backgroundColor: 'rgba(255, 255, 0, 0.3)',
    borderBottom: '2px dotted #f8c300',
  },
})
