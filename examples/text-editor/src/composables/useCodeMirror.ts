import { useCollabStore } from '@/stores/collab'
import { useDocumentStore } from '@/stores/document'
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete'
import { defaultKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import {
  bracketMatching,
  defaultHighlightStyle,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language'
import { lintKeymap } from '@codemirror/lint'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { EditorState } from '@codemirror/state'
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'
import { Cursors } from '@collabs/collabs'
import type { Ref } from 'vue'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { createCollabExtension, isProcessedAnnotation } from './collab-extension'

/**
 * Ein Vue 3 Composable zur Verwaltung einer CodeMirror 6 Instanz,
 * die mit den Kollaborations-Stores synchronisiert wird.
 *
 * @param elementRef Eine Ref auf das DOM-Element, in das der Editor gemountet werden soll.
 */
export function useCodeMirror(elementRef: Ref<HTMLDivElement | null>) {
  const view = ref<EditorView | null>(null)

  const docStore = useDocumentStore()
  const collabStore = useCollabStore()

  /**
   * Erstellt eine neue EditorView-Instanz mit dem aktuellen State
   * aus dem DocumentStore und den Kollaborations-Extensions.
   */
  function createEditor() {
    if (!elementRef.value) return

    // Bestehende Instanz zerstören, falls vorhanden
    if (view.value) {
      view.value.destroy()
    }

    view.value = new EditorView({
      doc: docStore.textContent,
      extensions: [
        markdown(),
        createCollabExtension(docStore, collabStore),
        EditorState.transactionFilter.of((tr) => {
          if (tr.docChanged && !tr.annotation(isProcessedAnnotation)) {
            tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
              setTimeout(() => {
                const deleted = tr.startState.doc.sliceString(fromA, toA)
                if (deleted.length > 0) {
                  docStore.deleteText(fromA, deleted.length, collabStore.isSuggestionMode)
                }
                if (inserted.length > 0) {
                  docStore.insertText(fromA, inserted.toString(), collabStore.isSuggestionMode)
                }
              })
            })
          } else if (docStore.document?.content.length) {
            const selection = tr.state.selection.main
            // Hier müssten die Indizes wieder in Cursor-Objekte umgewandelt werden
            collabStore.updateMyPresence({
              selection: {
                document: docStore.id!,
                anchor: Cursors.fromIndex(selection.anchor, docStore.document.content),
                head: Cursors.fromIndex(selection.head, docStore.document.content),
              },
            })
          }

          return !tr.annotation(isProcessedAnnotation) && tr.docChanged ? {} : tr
        }),
        // A line number gutter
        lineNumbers(),
        // A gutter with code folding markers
        // foldGutter(),
        // Replace non-printable characters with placeholders
        highlightSpecialChars(),
        // The undo history
        // history(),
        // Replace native cursor/selection with our own
        drawSelection(),
        // Show a drop cursor when dragging over the editor
        dropCursor(),
        // Allow multiple cursors/selections
        // EditorState.allowMultipleSelections.of(true),
        // Re-indent lines when typing specific input
        indentOnInput(),
        // Highlight syntax with a default style
        syntaxHighlighting(defaultHighlightStyle),
        // Highlight matching brackets near cursor
        bracketMatching(),
        // Automatically close brackets
        closeBrackets(),
        // Load the autocompletion system
        autocompletion(),
        // Allow alt-drag to select rectangular regions
        rectangularSelection(),
        // Change the cursor to a crosshair when holding alt
        crosshairCursor(),
        // Style the current line specially
        highlightActiveLine(),
        // Style the gutter for current line specially
        highlightActiveLineGutter(),
        // Highlight text that matches the selected text
        highlightSelectionMatches(),
        keymap.of([
          // Closed-brackets aware backspace
          ...closeBracketsKeymap,
          // A large set of basic bindings
          ...defaultKeymap,
          // Search-related keys
          ...searchKeymap,
          // Code folding bindings
          ...foldKeymap,
          // Autocompletion keys
          ...completionKeymap,
          // Keys related to the linter system
          ...lintKeymap,
        ]),
      ],
      parent: elementRef.value,
    })
  }

  // Erstellt den Editor, wenn die Komponente gemountet wird.
  onMounted(() => {
    if (docStore.isDocumentLoaded) {
      createEditor()
    }
  })

  // Zerstört die Editor-Instanz, um Memory-Leaks zu vermeiden.
  onUnmounted(() => {
    if (view.value) {
      view.value.destroy()
    }
  })

  // Beobachtet, ob sich das aktive Dokument ändert. Wenn ja, wird der Editor
  // neu erstellt, um den neuen Inhalt und die zugehörigen Daten zu laden.
  watch(
    () => docStore.id,
    (newId, oldId) => {
      if (newId !== oldId && elementRef.value) {
        console.log(`Document changed to ${newId}, recreating editor.`)
        createEditor()
      }
    },
  )

  return { view }
}
