/**
 * Derived from the YJS plugin for CodeMirror 6:
 * https://github.com/yjs/y-codemirror.next/blob/main/src/y-remote-selections.js
 */

import { StateEffect } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view'
import { Cursors } from '@collabs/collabs'
import { type PresenceState } from 'track-changes-application'
import { trackChangesFacet } from './collab-config'

const setRemoteStates = StateEffect.define<readonly PresenceState[]>()

class RemoteCaretWidget extends WidgetType {
  constructor(
    readonly color: string,
    readonly name: string,
  ) {
    super()
  }

  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-remote-caret'
    span.style.borderLeftColor = this.color

    const nameDiv = document.createElement('div')
    nameDiv.className = 'cm-remote-caret-name'
    nameDiv.textContent = this.name
    nameDiv.style.backgroundColor = this.color

    return span
  }
}

export const trackChangesRemoteCursors = ViewPlugin.fromClass(
  class {
    decorations = Decoration.none

    constructor(view: EditorView) {
      const config = view.state.facet(trackChangesFacet)

      if (!config.presence) {
        console.warn(
          'TrackChangesConfig: No presence configured, remote cursors will not be displayed',
        )
        return
      }

      const presenceListener = () => {
        const states = Array.from(config.presence!.entries()).map((p) => p[1] as PresenceState)
        setTimeout(() => {
          view.dispatch({ effects: setRemoteStates.of(states) })
        })
      }
      config.presence.on('Set', presenceListener)
      config.presence.on('Delete', presenceListener)

      setTimeout(() => {
        view.dispatch({
          effects: setRemoteStates.of(
            Array.from(config.presence!.entries()).map((p) => p[1] as PresenceState),
          ),
        })
      })
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet) {
        const config = update.state.facet(trackChangesFacet)
        const docLength = config.doc.content.length

        const selection = update.state.selection.main
        const cursors = config.toCollabCursors(
          Math.min(selection.anchor, docLength),
          Math.min(selection.head, docLength),
        )
        const viewing = config.presence?.getOurs()?.viewing ?? false

        config.presence?.setOurs({
          userId: config.userId,
          replicaId: config.doc.runtime.replicaID,
          viewing,
          selection: {
            document: config.doc.id,
            anchor: cursors.anchor,
            head: cursors.head,
          },
        })
      }

      for (const effect of update.transactions.flatMap((tr) => tr.effects)) {
        if (effect.is(setRemoteStates)) {
          this.decorations = this.buildDecorations(update.view, effect.value)
        }
      }
    }

    buildDecorations(view: EditorView, states: readonly PresenceState[]): DecorationSet {
      const config = view.state.facet(trackChangesFacet)
      const decorations = []
      const docLength = config.doc.content.length

      for (const state of states) {
        if (
          state.userId === config.userId ||
          !state.selection ||
          state.selection.document !== config.doc.id
        ) {
          continue
        }

        const anchorPos = Cursors.toIndex(state.selection.anchor, config.doc.content)
        const headPos = Cursors.toIndex(state.selection.head, config.doc.content)

        if (anchorPos === undefined || headPos === undefined) continue

        const from = Math.min(Math.min(anchorPos, headPos), docLength)
        const to = Math.min(Math.max(anchorPos, headPos), docLength)
        const color = getUserColor(state.userId, 0.3)

        if (from !== to) {
          decorations.push(
            Decoration.mark({
              attributes: { style: `background-color: ${color}` },
              class: 'cm-remote-selection',
            }).range(from, to),
          )
        }

        decorations.push(
          Decoration.widget({
            widget: new RemoteCaretWidget(color, state.userId.substring(0, 5)),
            side: headPos < anchorPos ? -1 : 1,
          }).range(headPos),
        )
      }

      return Decoration.set(decorations, true)
    }
  },
  {
    decorations: (v) => v.decorations,
  },
)

export function getUserColor(userId: string, transparency = 1.0) {
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash)
  }
  const color = (hash & 0x00ffffff).toString(16).toUpperCase()
  return (
    '#' +
    '00000'.substring(0, 6 - color.length) +
    color +
    Math.floor(transparency * 255)
      .toString(16)
      .padStart(2, '0')
  )
}

export const remoteCursorsTheme = EditorView.baseTheme({
  '.cm-remote-selection': {},
  '.cm-remote-caret': {
    position: 'relative',
    borderLeft: '2px solid black',
    marginLeft: '-1px',
    boxSizing: 'border-box',
    display: 'inline',
  },
  '.cm-remote-caret-name': {
    position: 'absolute',
    top: '-1.4em',
    left: '-1px',
    fontSize: '0.8em',
    color: 'white',
    padding: '2px 4px',
    borderRadius: '3px',
    whiteSpace: 'nowrap',
    userSelect: 'none',
  },
})
