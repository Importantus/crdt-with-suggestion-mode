import { Facet } from '@codemirror/state'
import { CPresence, Cursors, type Cursor } from '@collabs/collabs'
import type { PresenceState } from 'track-changes-application'
import { TrackChangesDocument } from 'track-changes-application'

/**
 * Options for configuring the TrackChanges collaborative editing feature.
 */
export interface TrackChangesOptions {
  /**
   * The TrackChangesDocument instance that manages the collaborative document state.
   * This document is used to track changes, manage suggestions, and handle collaborative editing.
   * It should be an instance of TrackChangesDocument from the 'track-changes-application' package.
   * @required
   */
  doc: TrackChangesDocument
  /**
   * Optional user ID for identifying the current user in the collaborative editor.
   * If not provided, a default user ID will be generated.
   */
  userId?: string | undefined
  /**
   * Optional presence object for managing user presence in the collaborative editor.
   * If provided, it will be used to track user cursors and selections.
   */
  presence?: CPresence<PresenceState> | undefined
}

const DEFAULT_TRACK_CHANGES_OPTIONS: Partial<TrackChangesOptions> = {
  presence: undefined,
}

export class TrackChangesConfig {
  public doc: TrackChangesDocument
  public presence: CPresence<PresenceState> | undefined
  public userId: string

  constructor(options: Partial<TrackChangesOptions> = {}) {
    if (!options.doc) {
      throw new Error('TrackChangesDocument is required')
    }

    this.doc = options.doc
    this.presence = options.presence ?? DEFAULT_TRACK_CHANGES_OPTIONS.presence
    this.userId = options.userId ?? `user-${Math.random().toString(36).substring(2, 9)}`
  }

  /**
   * Converts a CodeMirror cursor (anchor and head positions)
   * into Collabs cursors that can be sent over the network.
   */
  toCollabCursors(anchor: number, head: number): { anchor: Cursor; head: Cursor } {
    const content = this.doc.content
    const collabAnchor = Cursors.fromIndex(anchor, content)
    const collabHead = Cursors.fromIndex(head, content)
    return { anchor: collabAnchor, head: collabHead }
  }
}

/**
 * A CodeMirror facet that provides access to the TrackChanges configuration.
 */
export const trackChangesFacet = Facet.define<TrackChangesConfig, TrackChangesConfig>({
  combine: (values) => values[values.length - 1], // Always use the last configuration
})
