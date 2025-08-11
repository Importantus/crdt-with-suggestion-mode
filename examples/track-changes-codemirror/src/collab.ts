import { Prec, type Extension } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { TrackChangesConfig, trackChangesFacet, type TrackChangesOptions } from './collab-config'
import { trackChangesDecorations, trackChangesTheme } from './collab-decoration'
import { remoteCursorsTheme, trackChangesRemoteCursors } from './collab-remote-cursors'
import { collabInputHandler, collabSync } from './collab-sync'

import { StateEffect, StateField } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

const setAnnotationMode = StateEffect.define<boolean>()

interface DynamicFlags {
  /**
   * Whether the user is currently in suggesting mode.
   * In this mode, edits are recorded as annotations rather than direct changes.
   */
  annotationMode: boolean
}

/**
 * StateField to manage dynamic flags for the track changes controller.
 * This fields holds flags that can be dynamically updated by the user
 */
export const dynamicFlagsField = StateField.define<DynamicFlags>({
  create() {
    return { viewing: true, annotationMode: false }
  },
  update(flags, tr) {
    for (const fx of tr.effects) {
      if (fx.is(setAnnotationMode)) flags = { ...flags, annotationMode: fx.value }
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

      // Render decorations for annotations and comments
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
   * Toggle suggesting mode on or off. When enabled, edits are recorded as annotations.
   * @param view - The CodeMirror EditorView instance.
   * @param on - `true` to enable suggesting mode, `false` to disable.
   */
  setAnnotationMode(view: EditorView, on: boolean): void {
    view.dispatch({ effects: setAnnotationMode.of(on) })
  }

  /** Get current flag values */
  getFlags(view: EditorView): DynamicFlags {
    return view.state.field(dynamicFlagsField)
  }
}
