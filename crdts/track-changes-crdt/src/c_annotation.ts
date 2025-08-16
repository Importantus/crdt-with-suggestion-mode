/**
 * A annotation log to store annotations and comments. Used by CTrackChanges.
 * Derived from https://github.com/composablesys/collabs/blob/master/crdts/src/list/c_span_log.ts
 */

import {
  CollabEvent,
  CollabEventsRecord,
  CRDTMessageMeta,
  CRDTSavedStateMeta,
  DefaultSerializer,
  InitToken,
  MessageMeta,
  Position,
  PrimitiveCRDT,
  SavedStateMeta,
  Serializer,
} from "@collabs/collabs";
import { v4 as uuidv4 } from "uuid";

/**
 * A unique identifier for an annotation.
 */
export type AnnotationId = string;

/**
 * Type of an annotation.
 */
export enum AnnotationType {
  /** A annotation that adds a textual comment to a range of text. */
  COMMENT = "comment",
  /** A annotation that proposes an insertion or deletion of text within a given range. */
  SUGGESTION = "suggestion",
}

/**
 * Specifies whether the annotation represents an addition or a removal of a mark.
 * An update is used to change specific properties of an existing annotation.
 */
export enum AnnotationAction {
  ADDITION = "addition",
  REMOVAL = "removal",
  UPDATE = "update",
}

/**
 * The more detailed description of what the annotation does.
 */
export enum AnnotationDescription {
  /** Adds a text comment to the given range */
  ADD_COMMENT = "addComment",
  /** Removes a text comment from the given range */
  REMOVE_COMMENT = "removeComment",
  /** Marks the given range as a annotation to insert text into the final document. */
  INSERT_SUGGESTION = "insertSuggestion",
  /** Marks the given range as a suggestion to delete text from the final document. */
  DELETE_SUGGESTION = "deleteSuggestion",
  /** Marks the text in the given range as an accepted suggestion */
  ACCEPT_SUGGESTION = "acceptSuggestion",
  /** Marks the text in the given range as a declined suggestion */
  DECLINE_SUGGESTION = "declineSuggestion",
}

/**
 * Base properties common to all annotations, including CRDT metadata.
 */
interface AnnotationBase {
  /** Unique ID for the annotation */
  readonly id: AnnotationId;
  /** Comment vs. suggestion */
  readonly type: AnnotationType;
  /** ID of the user account that created the annotation */
  readonly userId: string;
  /** Lamport timestamp of the action that inserted the annotation */
  readonly lamport: number;
  /** ID of the sender, used for lamport tie-breaking */
  readonly senderID: string;
  /** The epoch timestamp. Only used for ui */
  readonly timestamp: number;
}

/**
 * Annotations that introduce a new mark (addition of comment or suggestion).
 */
export interface AdditionAnnotation extends AnnotationBase {
  readonly action: AnnotationAction.ADDITION;
  readonly description:
    | AnnotationDescription.ADD_COMMENT
    | AnnotationDescription.INSERT_SUGGESTION
    | AnnotationDescription.DELETE_SUGGESTION;
  /** The value holds comment text for ADD_COMMENT; undefined otherwise */
  readonly value?: string;
  /** Start of the text range this annotation applies to */
  readonly startPosition: Position | null;
  /** If true, insertion at startPosition counts as inside range */
  readonly startClosed: boolean;
  /** End of the text range; null for end of document */
  readonly endPosition: Position | null;
  /** If true, insertion at endPosition counts as inside range */
  readonly endClosed: boolean;
}

/**
 * Annotations that remove or resolve an existing mark.
 */
export interface RemovalAnnotation extends AnnotationBase {
  readonly action: AnnotationAction.REMOVAL;
  readonly description:
    | AnnotationDescription.REMOVE_COMMENT
    | AnnotationDescription.ACCEPT_SUGGESTION
    | AnnotationDescription.DECLINE_SUGGESTION;
  /** When dependent on another annotation, the ID of that annotation */
  readonly dependentOn: AnnotationId;
}

/**
 * Annotations that update specific properties of an existing annotation.
 */
export interface UpdateAnnotation extends AnnotationBase {
  readonly action: AnnotationAction.UPDATE;
  /** ID of the original addition annotation to update */
  readonly dependentOn: AnnotationId;
  readonly userId: string;
  readonly updatedProperties: Partial<
    Omit<
      AdditionAnnotation,
      "id" | "lamport" | "senderID" | "action" | "userId" | "type"
    >
  >;
}

/**
 * Unified annotation type for all actions.
 */
export type Annotation =
  | AdditionAnnotation
  | RemovalAnnotation
  | UpdateAnnotation;

/**
 * Partial form of an Annotation without CRDT metadata for serialization.
 */
export type PartialAnnotation = Omit<Annotation, "lamport" | "senderID">;

/**
 * Saved state shape for the annotation log CRDT.
 */
interface AnnotationLogSavedState {
  /** IDs of annotations with action ADDITION, groups for dependent annotations */
  changeIds: string[];
  /** Number of annotations per change ID */
  lengths: number[];
  /** Flattened list of partial annotations */
  annotations: PartialAnnotation[];
  /** Corresponding Lamport timestamps */
  lamports: number[];
}

/**
 * Event emitted when an annotation is added (local or remote).
 */
export interface AnnotationAddEvent extends CollabEvent {
  annotation: Annotation;
}

export interface AnnotationEventsRecord extends CollabEventsRecord {
  Add: AnnotationAddEvent;
}

/**
 * An append-only log of annotations and comments.
 * Used internally by CTrackChanges to track all changes.
 */
export class CAnnotationLog extends PrimitiveCRDT<AnnotationEventsRecord> {
  /** Log grouped by addition annotation IDs for efficient retrieval */
  public readonly log = new Map<string, Annotation[]>();

  private readonly partialAnnotationSerializer: Serializer<PartialAnnotation> =
    DefaultSerializer.getInstance<PartialAnnotation>();
  private readonly savedStateSerializer: Serializer<AnnotationLogSavedState> =
    DefaultSerializer.getInstance<AnnotationLogSavedState>();

  constructor(init: InitToken) {
    super(init);
  }

  /**
   * Adds a new addition annotation (comment or suggestion).
   * Broadcasts to other replicas.
   */
  add(
    annotation: Omit<Annotation, "id" | "lamport" | "senderID" | "timestamp">
  ): void {
    console.log("Adding annotation", annotation);
    super.sendCRDT(
      this.partialAnnotationSerializer.serialize({
        ...annotation,
        id: uuidv4(),
        timestamp: Date.now(),
      })
    );
  }

  protected override receiveCRDT(
    message: Uint8Array | string,
    meta: MessageMeta,
    crdtMeta: CRDTMessageMeta
  ): void {
    const decoded = this.partialAnnotationSerializer.deserialize(
      message as Uint8Array
    );

    const annotation: Annotation = {
      ...decoded,
      lamport: getOrThrow(crdtMeta.lamportTimestamp),
      senderID: crdtMeta.senderID,
    } as Annotation;

    const id =
      annotation.action === AnnotationAction.ADDITION
        ? annotation.id
        : getOrThrow(annotation.dependentOn);

    this.log.set(
      id,
      [...(this.log.get(id) || []), annotation].sort((a, b) => {
        if (a.lamport !== b.lamport) {
          return a.lamport - b.lamport;
        }
        return a.senderID.localeCompare(b.senderID);
      })
    );

    this.emit("Add", { annotation, meta });
  }

  protected override saveCRDT(): Uint8Array {
    const changeIds = Array.from({ length: this.log.size });
    const lengths = Array.from({ length: this.log.size });
    const annotations: Annotation[] = [];
    const lamports: number[] = [];

    let i = 0;
    for (const [changeId, senderAnnotations] of this.log) {
      changeIds[i] = changeId;
      lengths[i] = senderAnnotations.length;
      for (const annotation of senderAnnotations) {
        annotations.push(annotation);
        lamports.push(annotation.lamport);
      }
      i++;
    }

    return this.savedStateSerializer.serialize({
      changeIds: changeIds,
      lengths,
      annotations,
      lamports,
    } as AnnotationLogSavedState);
  }

  protected override loadCRDT(
    savedState: Uint8Array | null,
    meta: SavedStateMeta,
    _: CRDTSavedStateMeta
  ): void {
    if (savedState === null) return;

    const decoded = this.savedStateSerializer.deserialize(savedState);
    let annotationIndex = 0;
    for (let i = 0; i < decoded.changeIds.length; i++) {
      const changeId = decoded.changeIds[i];
      let lastLamport: number;
      let byChange = this.log.get(changeId);
      if (byChange === undefined) {
        byChange = [];
        this.log.set(changeId, byChange);
        lastLamport = -1;
      } else {
        lastLamport = byChange[byChange.length - 1].lamport;
      }

      for (let j = 0; j < decoded.lengths[i]; j++) {
        const lamport = decoded.lamports[annotationIndex];
        if (lamport > lastLamport) {
          const annotation: Annotation = {
            ...decoded.annotations[annotationIndex],
            lamport,
            senderID: changeId,
          } as Annotation;
          byChange.push(annotation);

          this.emit("Add", { annotation, meta });
        }
        annotationIndex++;
      }
    }
  }
}

function getOrThrow(it: any) {
  if (it === null || it === undefined) {
    throw new Error("The requested value is null or undefined");
  } else {
    return it;
  }
}
