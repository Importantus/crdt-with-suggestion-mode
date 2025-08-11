import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import { type Position } from "@collabs/collabs";
import { AnnotationDescription, type AnnotationId } from "track-changes-crdt";
import type { AdditionAnnotation } from "track-changes-crdt/build/esm/c_annotation";
import { trackChangesFacet } from "./collab-config";

const annotationInsertClass = "cm-annotation-insert";
const annotationDeleteClass = "cm-annotation-delete";
const commentClass = "cm-comment-range";

/**
 * Converts a Annotation object into a CodeMirror Decoration.
 * Applies a CSS class and data attribute based on annotation type.
 *
 * @param annotation - The annotation metadata including id and description.
 * @returns A Decoration marking the suggested range in the editor.
 */
function annotationToDecoration(annotation: AdditionAnnotation): Decoration {
  let className = "";
  switch (annotation.description) {
    case AnnotationDescription.INSERT_SUGGESTION:
      className = annotationInsertClass;
      break;
    case AnnotationDescription.DELETE_SUGGESTION:
      className = annotationDeleteClass;
      break;
    case AnnotationDescription.ADD_COMMENT:
      className = commentClass;
      break;
  }
  return Decoration.mark({
    class: className,
    attributes: { "data-annotation-id": annotation.id },
  });
}

/**
 * A CodeMirror ViewPlugin that tracks active annotations and updates decorations accordingly.
 * Stores annotations by position rather than index to handle collaborative edits.
 */
export const trackChangesDecorations = ViewPlugin.fromClass(
  class {
    /** Current set of decorations applied to the editor. */
    decorations: DecorationSet = Decoration.none;

    /**
     * Map of active annotations keyed by annotation ID.
     * Each entry holds the annotation data and its start/end positions.
     */
    activeAnnotations = new Map<
      AnnotationId,
      {
        annotation: AdditionAnnotation;
        startPos: Position | null;
        endPos: Position | null;
      }
    >();

    /**
     * Initializes the plugin: loads existing annotations and subscribes to updates.
     * @param view - The EditorView instance this plugin is attached to.
     */
    constructor(view: EditorView) {
      const config = view.state.facet(trackChangesFacet);

      // Subscribe to addition of new annotations
      config.doc.content.on("AnnotationAdded", (event) => {
        const { annotation } = event;
        this.activeAnnotations.set(annotation.id, {
          annotation,
          startPos: annotation.startPosition,
          endPos: annotation.endPosition,
        });
        this.updateDecorations(view);
      });

      // Subscribe to removal of annotations
      config.doc.content.on("AnnotationRemoved", (event) => {
        this.activeAnnotations.delete(event.annotation.id);
        this.updateDecorations(view);
      });

      // Initialize map with pre-existing active annotations
      this.activeAnnotations = config.doc.content
        .getActiveAnnotations()
        .reduce((map, item) => {
          map.set(item.id, {
            annotation: item,
            startPos: item.startPosition,
            endPos: item.endPosition,
          });
          return map;
        }, new Map<AnnotationId, { annotation: AdditionAnnotation; startPos: Position | null; endPos: Position | null }>());

      // Initial render of decorations
      this.updateDecorations(view);
    }

    /**
     * Reacts to document or viewport changes by recalculating decorations.
     * @param update - The ViewUpdate containing change details.
     */
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.updateDecorations(update.view);
      }
    }

    /**
     * Computes and applies decorations for all active annotations.
     * Translates stored positions to current document indices.
     * @param view - The EditorView used to dispatch decoration updates.
     */
    updateDecorations(view: EditorView) {
      const config = view.state.facet(trackChangesFacet);
      const content = config.doc.content;
      const decorations = [];

      for (const item of this.activeAnnotations.values()) {
        console.debug("Processing annotation:", item.annotation);
        let startIndex = item.startPos
          ? content.indexOfPosition(item.startPos, "left")
          : 0;
        if (startIndex === -1) continue; // Skip if position no longer valid

        let endIndex = item.endPos
          ? content.indexOfPosition(item.endPos, "right")
          : content.length;
        if (endIndex === -1) continue;

        // Extend range if the annotation end is closed
        if (item.annotation.endClosed && endIndex < content.length) {
          endIndex += 1;
        }

        // Reduce range if the start is open
        if (item.annotation.startClosed === false && item.startPos) {
          startIndex += 1;
        }

        if (startIndex < endIndex) {
          decorations.push(
            annotationToDecoration(item.annotation).range(startIndex, endIndex)
          );
        }
      }

      // Update the decoration set and force a redraw
      this.decorations = Decoration.set(decorations, true);
      setTimeout(() => {
        view.dispatch({
          effects: [],
        });
      });
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

/**
 * Defines CSS styles for annotation highlights and comments in the editor.
 * Uses a light background and underline/strikethrough to indicate changes.
 */
export const trackChangesTheme = EditorView.baseTheme({
  [`& .${annotationInsertClass}`]: {
    backgroundColor: "rgba(0, 255, 0, 0.2)",
    textDecoration: "underline solid #0a0 2px",
  },
  [`& .${annotationDeleteClass}`]: {
    backgroundColor: "rgba(255, 0, 0, 0.2)",
    textDecoration: "line-through solid #a00 2px",
  },
  [`& .${commentClass}`]: {
    backgroundColor: "rgba(255, 255, 0, 0.3)",
    borderBottom: "2px dotted #f8c300",
  },
});
