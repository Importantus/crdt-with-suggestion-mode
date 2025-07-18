import { Prec, type Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { TrackChangesConfig, trackChangesFacet, type TrackChangesOptions } from './collab-config'
import { trackChangesDecorations, trackChangesTheme } from './collab-decoration'
import { remoteCursorsTheme, trackChangesRemoteCursors } from './collab-remote-cursors'
import { collabInputHandler, collabSync } from './collab-sync'

import { StateEffect, StateField } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

const setSuggestionMode = StateEffect.define<boolean>()

interface DynamicFlags {
  /**
   * Whether the user is currently in suggesting mode.
   * In this mode, edits are recorded as suggestions rather than direct changes.
   */
  suggestionMode: boolean
}

/**
 * StateField to manage dynamic flags for the track changes controller.
 * This fields holds flags that can be dynamically updated by the user
 */
export const dynamicFlagsField = StateField.define<DynamicFlags>({
  create() {
    return { viewing: true, suggestionMode: false }
  },
  update(flags, tr) {
    for (let fx of tr.effects) {
      if (fx.is(setSuggestionMode)) flags = { ...flags, suggestionMode: fx.value }
    }
    return flags
  },
})

/**
 * Integrates collaborative track changes functionality into a CodeMirror editor.
 * @param options - Configuration options for track changes and collaboration.
 */
export class TrackChangesAPI {
  private config: TrackChangesConfig

  constructor(options: TrackChangesOptions) {
    this.config = new TrackChangesConfig(options)
  }

  /**
   * Get the CodeMirror extensions required for collaborative track changes.
   * @returns An array of CodeMirror extensions to be added to the editor.
   */
  getExtensions(): Extension[] {
    const extensions: Extension[] = [
      // Provide track changes configuration via a facet
      trackChangesFacet.of(this.config),

      // Intercept user input (with high precedence)
      collabInputHandler,

      // Enable controller for dynamic flags
      dynamicFlagsField,

      // Synchronize CRDT events with the editor state
      collabSync,

      // Render decorations for suggestions and comments
      trackChangesDecorations,
      trackChangesTheme,

      // Optionally enable remote cursors and selections
      ...(this.config.presence ? [trackChangesRemoteCursors, remoteCursorsTheme] : []),

      // Disable default undo/redo behavior (Mod-z, Mod-y)
      Prec.high(
        keymap.of([
          { key: 'Mod-z', run: () => true },
          { key: 'Mod-y', run: () => true },
          { key: 'Mod-Shift-z', run: () => true },
        ]),
      ),
    ]

    return extensions
  }

  /**
   * Toggle suggesting mode on or off. When enabled, edits are recorded as suggestions.
   * @param view - The CodeMirror EditorView instance.
   * @param on - `true` to enable suggesting mode, `false` to disable.
   */
  setSuggestionMode(view: EditorView, on: boolean): void {
    view.dispatch({ effects: setSuggestionMode.of(on) })
  }

  /** Get current flag values */
  getFlags(view: EditorView): DynamicFlags {
    return view.state.field(dynamicFlagsField)
  }
}
