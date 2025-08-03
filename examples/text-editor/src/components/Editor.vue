<script setup lang="ts">
import { TrackChangesAPI } from '@/collab-codemirror/collab';
import { useCollabStore } from '@/stores/collab';
import { useDocumentStore } from '@/stores/document';
import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete';
import { defaultKeymap } from '@codemirror/commands';
import {
  bracketMatching,
  defaultHighlightStyle,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { lintKeymap } from '@codemirror/lint';
import { searchKeymap } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
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
  rectangularSelection
} from '@codemirror/view';
import { ayuLight } from 'thememirror';
import { onMounted, ref, watch } from 'vue';

const editorRef = ref<HTMLDivElement | null>(null);
const collabStore = useCollabStore();
const documentStore = useDocumentStore();
let view: EditorView | null = null;
let api: TrackChangesAPI | null = null;

onMounted(() => {
  watch(() => collabStore.isSuggestionMode, (isSuggestionMode) => {
    if (view && api) {
      api.setSuggestionMode(view, isSuggestionMode);
      console.log('Suggestion mode changed:', isSuggestionMode);
    }
  });

  watch(() => documentStore.document, (newDoc) => {
    if (view) {
      view.destroy();
      view = null;
    }

    if (api) {
      api = null;
    }

    if (newDoc && collabStore.app && editorRef.value) {
      api = new TrackChangesAPI({
        doc: newDoc,
        userId: collabStore.currentUserId,
        presence: collabStore.app.presence
      })

      const state = EditorState.create({
        doc: newDoc.content.toString(), // Initialer Text
        extensions: [
          api.getExtensions(),
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
          // highlightSelectionMatches(),
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

          EditorView.lineWrapping,
          EditorView.baseTheme({
            '&.cm-gutters.cm-gutters-before': {
              borderRightWidth: '0px',
            },
            '.cm-scroller': {
              overflow: 'auto',
            },
            '.cm-editor': {
              height: '500px',
            },
            '&.cm-editor.cm-focused': {
              outline: '0px solid transparent',
            },
          }),
          ayuLight,
        ]
      });

      view = new EditorView({
        state,
        parent: editorRef.value,
      });

      api.setSuggestionMode(view, collabStore.isSuggestionMode);
    }
  }, { immediate: true });
});
</script>

<template>
  <div class="min-h-96 bg-white shadow rounded-lg h-fit overflow-hidden" ref="editorRef"></div>
</template>
