import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import { AnnotationDescription, type AnnotationId } from "track-changes-crdt";
import type { AdditionAnnotation } from "track-changes-crdt/build/esm/c_annotation";
import { trackChangesFacet } from "./collab-config";
import { addTransparencyToColor } from "./utils/color";

/**
 * Converts a Annotation object into a CodeMirror Decoration.
 * Applies a CSS class and data attribute based on annotation type.
 *
 * @param annotation - The annotation metadata including id and description.
 * @returns A Decoration marking the suggested range in the editor.
 */
function annotationToDecoration(
  annotation: AdditionAnnotation,
  userColor: string
): Decoration {
  let style = "";
  const userColorFull = userColor;
  const userColorTransparent = addTransparencyToColor(userColor, 0.2);

  switch (annotation.description) {
    case AnnotationDescription.INSERT_SUGGESTION:
      style = `background-color: ${userColorTransparent}; text-decoration: underline solid ${userColorFull} 2px;`;
      break;
    case AnnotationDescription.DELETE_SUGGESTION:
      style = `background-color: ${userColorTransparent}; text-decoration: line-through solid ${userColorFull} 2px;`;
      break;
    case AnnotationDescription.ADD_COMMENT:
      style = `background-color: rgba(255, 255, 0, 0.3); border-bottom: 2px dotted #f8c300;`;
      break;
  }

  return Decoration.mark({
    attributes: { "data-annotation-id": annotation.id, style },
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
    activeAnnotations = new Map<AnnotationId, AdditionAnnotation>();

    /**
     * Initializes the plugin: loads existing annotations and subscribes to updates.
     * @param view - The EditorView instance this plugin is attached to.
     */
    constructor(view: EditorView) {
      const config = view.state.facet(trackChangesFacet);

      // Subscribe to addition of new annotations
      config.doc.content.on("AnnotationAdded", (event) => {
        const { annotation } = event;
        this.activeAnnotations.set(annotation.id, annotation);
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
          map.set(item.id, item);
          return map;
        }, new Map<AnnotationId, AdditionAnnotation>());

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
        let startIndex = item.startPosition
          ? content.indexOfPosition(item.startPosition, "left")
          : -1; // -1 because we have an open start and the annotation is practically fixed to the character before the insertion (char 0)

        let endIndex = item.endPosition
          ? content.indexOfPosition(item.endPosition, "right")
          : content.length;
        if (endIndex === -1) {
          endIndex = content.length; // Fallback to end of document if position not found
        }

        let startCheckIndex = item.startPosition
          ? content.indexOfPosition(item.startPosition, "right")
          : 0;

        let endCheckIndex = item.endPosition
          ? content.indexOfPosition(item.endPosition, "left")
          : content.length;

        if (startCheckIndex > endCheckIndex) {
          continue; // Skip if start position is after end position
        }

        // Extend range if the annotation end is closed
        if (
          item.endClosed &&
          endIndex < content.length &&
          endCheckIndex === endIndex // Only extend if the end is closed and the real end position is not already deleted
        ) {
          endIndex += 1;
        }

        // Reduce range if the start is open
        if (
          item.startClosed === false ||
          startCheckIndex !== startIndex // If the start is closed and the real start position is already deleted, we also need to reduce the range
        ) {
          startIndex += 1;
        }

        if (startIndex < endIndex) {
          decorations.push(
            annotationToDecoration(
              item,
              config.getUserColor(item.userId)
            ).range(startIndex, endIndex)
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
