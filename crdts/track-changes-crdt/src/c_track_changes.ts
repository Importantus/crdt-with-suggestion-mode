import {
  CObject,
  CollabEvent,
  CollabEventsRecord,
  CTotalOrder,
  ICursorList,
  InitToken,
  LocalList,
  Position,
  TextEvent,
  UpdateMeta,
} from "@collabs/collabs";
import {
  AdditionAnnotation,
  Annotation,
  AnnotationAction,
  AnnotationDescription,
  AnnotationId,
  AnnotationType,
  CAnnotationLog,
  RemovalAnnotation,
  UpdateAnnotation,
} from "./c_annotation";
import { CustomCValueList } from "./custom_c_value_list";

export interface TrackChangesTextInsertEvent extends TextEvent {
  annotations: null | Annotation[];
}

export interface TrackChangesAnnotationAddedEvent extends CollabEvent {
  /**
   * The range's starting index, inclusive.
   *
   * The affected characters are `text.slice(startIndex, endIndex)`.
   */
  startIndex: number;
  /**
   * The range's ending index, exclusive.
   *
   * The affected characters are `text.slice(startIndex, endIndex)`.
   */
  endIndex: number;
  /**
   * The new annotation
   */
  annotation: AdditionAnnotation;
}

/**
 * The possible reasons why a suggestion can be removed from a document
 */
export enum AnnotationRemovalReason {
  /**
   * A user accepted the suggestion
   */
  ACCEPTED = "accepted",
  /**
   * A user declined the suggestion
   */
  DECLINED = "declined",
  /**
   * Some suggestions like delete suggestions only grow by extending their range.
   * If this happens, the old and shorter suggestion gets replaced.
   */
  REPLACED = "replaced",
  /**
   * The user removed the annotation
   * This is mainly used for comments
   */
  REMOVED = "removed",
}

export interface TrackChangesAnnotationRemovedEvent extends CollabEvent {
  /**
   * The id of the user who is responsible for removing the annotation
   */
  author: string;
  /**
   * The range's starting index, inclusive.
   *
   * The affected characters are `text.slice(startIndex, endIndex)`.
   */
  startIndex: number;
  /**
   * The range's ending index, exclusive.
   *
   * The affected characters are `text.slice(startIndex, endIndex)`.
   */
  endIndex: number;
  /**
   * The reason why the annotation was removed
   */
  reason: AnnotationRemovalReason;
  /**
   * The annotation that got removed
   */
  annotation: AdditionAnnotation;
}

export interface TrackChangesEventsRecord extends CollabEventsRecord {
  Insert: TrackChangesTextInsertEvent;
  Delete: TextEvent;
  AnnotationAdded: TrackChangesAnnotationAddedEvent;
  AnnotationRemoved: TrackChangesAnnotationRemovedEvent;
}

/**
 * As stated in the peritext paper, whenever a format (here: annotation) changes,
 * there is a datapoint at that position with all currently and onwards applied format data.
 * This is ordered by annotation type (e.g. comments, suggestions). When applying a new
 * annotation action, it must be calculated, which annotations can be replaced:
 * e.g. if there is an "insertion suggestion" tag and an "accept suggestion" tag
 * is added, the "insertion suggestion" tag is no longer needed.
 *
 * The endingHere flag indicates whether this is the end of a formatting range.
 * If the formatting has the endClosed flag set to true, then the end is part of the range
 * (inclusive, i.e., also formatted). If the endClosed flag is set to false,
 * then the end is not part of the range and not formatted.
 */
type AnnotationDataPoint = Map<
  AnnotationType,
  (AdditionAnnotation & { endingHere: boolean; startingHere: boolean })[]
>;

export class TrackChanges
  extends CObject<TrackChangesEventsRecord>
  implements ICursorList
{
  /**
   * The base text that is edited. An immutable list of chars whose positions
   * are tracked via a crdt that losesly implements the Fugue algorithm:
   * https://collabs.readthedocs.io/en/latest/api/crdts/classes/CTotalOrder.html
   * https://mattweidner.com/2022/10/21/basic-list-crdt.html
   */
  private readonly text: CustomCValueList<string>;
  /**
   * The crdt that is responsible for syncing and storing the annotation markers
   */
  private readonly annotationLog: CAnnotationLog;

  /**
   * This is a not replicated, local view of the annotationList mapped to their specific text positions.
   * This is described in the peritext paper.
   */
  private readonly annotationList: LocalList<AnnotationDataPoint>;

  /**
   * The id of the user making the changes
   */
  private readonly userId: string;

  constructor(
    init: InitToken,
    options: {
      userId: string;
    }
  ) {
    super(init);

    this.userId = options.userId;

    this.text = super.registerCollab(
      "text",
      (init) => new CustomCValueList<string>(init)
    );

    this.annotationLog = super.registerCollab(
      "annotationLog",
      (init) => new CAnnotationLog(init)
    );

    this.annotationList = new LocalList(this.text.totalOrder);

    this.annotationLog.on("Add", (e) =>
      this.onAnnotationLogAdd(e.annotation, e.meta)
    );

    this.text.on("Insert", (e) => {
      this.emit("Insert", {
        index: e.index,
        values: e.values.join(""),
        positions: e.positions,
        annotations: this.getAnnotationsInternal(e.positions[0]),
        meta: e.meta,
      });
    });

    this.text.on("Delete", (e) => {
      this.emit("Delete", {
        index: e.index,
        values: e.values.join(""),
        positions: e.positions,
        meta: e.meta,
      });
    });
  }

  /**
   * The number of visible characters in the document.
   * Deleted characters are not counted.
   */
  get length(): number {
    return this.text.length;
  }

  /**
   * Event handler for the annotationLog's "Add" event. Orchestrates the
   * processing of a new annotation.
   */
  private onAnnotationLogAdd(annotation: Annotation, meta: UpdateMeta) {
    this.processAnnotation(annotation, meta);
  }

  /**
   * Processes a new annotation by updating the local state and emitting corresponding events.
   * This is the main orchestration method.
   *
   * @param annotation The new annotation to process.
   * @param meta The update metadata.
   */
  private processAnnotation(annotation: Annotation, meta: UpdateMeta) {
    const getExistingOps = (key: string) => this.annotationLog.log.get(key);
    const isRemoval = annotation.action === AnnotationAction.REMOVAL;
    const isUpdate = annotation.action === AnnotationAction.UPDATE;
    const isAddition = annotation.action === AnnotationAction.ADDITION;

    // --------- Case 1: REMOVAL ---------
    if (isRemoval) {
      const existing = getExistingOps(annotation.dependentOn);

      if (!existing || existing.length === 0) {
        console.error(
          "Received removal annotation without existing addition annotations, ignoring"
        );
        return;
      }

      const lastAction = existing[existing.length - 1].action;

      if (lastAction !== AnnotationAction.REMOVAL) {
        console.warn(
          `Ignoring removal annotation ${annotation.id} because a newer addition or update operation exists`
        );
        return;
      }

      const additionAnnotation = existing.find(
        (a) => a.id === annotation.dependentOn
      ) as AdditionAnnotation | undefined;

      if (!additionAnnotation) {
        console.warn(
          `Ignoring removal annotation ${annotation.id} because the corresponding addition annotation does not yet exist`
        );
        return;
      }

      const removalReason =
        annotation.description === AnnotationDescription.DECLINE_SUGGESTION
          ? AnnotationRemovalReason.DECLINED
          : annotation.description === AnnotationDescription.ACCEPT_SUGGESTION
            ? AnnotationRemovalReason.ACCEPTED
            : AnnotationRemovalReason.REMOVED;

      this.removeAnnotation(
        this.applyUpdateOperations(additionAnnotation, existing),
        meta,
        removalReason,
        annotation.userId
      );

      return;
    }

    // --------- Case 2: UPDATE ---------
    if (isUpdate) {
      const existing = getExistingOps(annotation.dependentOn);

      if (!existing || existing.length === 0) {
        console.error(
          "Received update annotation without existing addition annotations, ignoring"
        );
        return;
      }

      if (existing[existing.length - 1].action === AnnotationAction.REMOVAL) {
        console.warn(
          `Ignoring update annotation ${annotation.id} because a newer removal operation exists`
        );
        return;
      }

      const additionAnnotation = existing.find(
        (a) => a.id === annotation.dependentOn
      ) as AdditionAnnotation | undefined;

      if (!additionAnnotation) {
        console.error(
          `Received update annotation ${annotation.id} for non-existing addition annotation ${annotation.dependentOn}, ignoring`
        );
        return;
      }

      const updatedAnnotation = this.applyUpdateOperations(
        additionAnnotation,
        existing
      );

      const relevantUpdates = existing.filter((a) => a.id !== annotation.id);

      const existingAnnotation = this.applyUpdateOperations(
        additionAnnotation,
        relevantUpdates
      );

      this.removeAnnotation(
        existingAnnotation,
        meta,
        AnnotationRemovalReason.REPLACED,
        existingAnnotation.userId
      );

      this.addAnnotation(updatedAnnotation, meta);

      return;
    }

    // --------- Case 3: ADDITION ---------
    if (isAddition) {
      const existing = getExistingOps(annotation.id);

      if (!existing || existing.length === 0) {
        console.error(
          "Received addition annotation without existing annotations, ignoring"
        );
        return;
      }

      if (existing[existing.length - 1].action === AnnotationAction.REMOVAL) {
        console.warn(
          `Ignoring addition annotation ${annotation.id} because a newer removal operation exists`
        );
        return;
      }

      this.addAnnotation(
        this.applyUpdateOperations(annotation, existing),
        meta
      );
    }
  }

  /**
   * Applies update operations to an addition annotation.
   * @param annotation The addition annotation to update.
   * @param updates The list of update annotations to apply.
   * @returns The updated addition annotation.
   */
  private applyUpdateOperations(
    annotation: AdditionAnnotation,
    updates: Annotation[]
  ) {
    let newAnnotation = { ...annotation };

    updates
      .filter((u) => u.action === AnnotationAction.UPDATE)
      .forEach((u) => {
        const update = u as UpdateAnnotation;
        if (update.dependentOn !== annotation.id) {
          console.warn(
            `Update annotation ${update.id} does not depend on the addition annotation ${annotation.id}, ignoring`
          );
          return;
        }

        // Apply the update properties to the new annotation
        newAnnotation = {
          ...newAnnotation,
          ...update.updatedProperties,
        };
      });

    return newAnnotation;
  }

  /**
   * Adds a new addition annotation to the annotationlist and emits the
   * TrackChangesAnnotationAddedEvent.
   * @param annotation The annotation to add.
   * @param meta The update metadata.
   * @private
   */
  private addAnnotation(annotation: AdditionAnnotation, meta: UpdateMeta) {
    // ---- Step 1: Prepare local state (create data points at the start and end) ----
    this.createDataPoint(
      annotation.startPosition
        ? annotation.startPosition
        : this.text.getPosition(0)
    );
    if (annotation.endPosition) this.createDataPoint(annotation.endPosition);

    const startIndex =
      annotation.startPosition === null
        ? null
        : this.annotationList.indexOfPosition(annotation.startPosition);
    const endIndex =
      annotation.endPosition === null
        ? null // If the annotation is open ended an goes to the end of the document, no ending should be set
        : this.annotationList.indexOfPosition(annotation.endPosition);

    // Go trough all datapoints in the given range and add the new annotation.
    for (
      let i = startIndex || 0;
      i <= (endIndex !== null ? endIndex : this.annotationList.length - 1); // If no end index is set, the annotation goes to the end of the document
      i++
    ) {
      const position = this.annotationList.getPosition(i);
      const data = this.annotationList.getByPosition(position)!;
      const isEnd = i === endIndex;
      const isStart = i === startIndex;

      data.set(annotation.type, [
        ...(data.get(annotation.type) || []),
        { ...annotation, endingHere: isEnd, startingHere: isStart },
      ]);

      console.log(position, i, data.get(annotation.type));
    }

    this.emit("AnnotationAdded", {
      startIndex: annotation.startPosition
        ? this.text.indexOfPosition(annotation.startPosition, "left")
        : 0,
      endIndex: annotation.endPosition
        ? this.text.indexOfPosition(annotation.endPosition, "right")
        : this.text.length,
      annotation,
      meta,
    });
  }

  /**
   * Removes an annotation from the annotation list and emits the
   * TrackChangesAnnotationRemovedEvent.
   * @param annotation The annotation to remove.
   * @param meta The update metadata.
   * @param reason The reason why the annotation was removed.
   * @param author The id of the user who is responsible for removing the annotation.
   */
  private removeAnnotation(
    annotation: AdditionAnnotation,
    meta: UpdateMeta,
    reason: AnnotationRemovalReason,
    author: string
  ) {
    const startIndex =
      annotation.startPosition === null
        ? null
        : this.annotationList.indexOfPosition(annotation.startPosition, "left");
    const endIndex =
      annotation.endPosition === null
        ? null // If the annotation is open ended an goes to the end of the document, no ending should be set
        : this.annotationList.indexOfPosition(annotation.endPosition);

    // Go trough all datapoints in the given range and remove the annotation.
    for (
      let i = startIndex || 0;
      i <= (endIndex !== null ? endIndex : this.annotationList.length - 1); // If no end index is set, the annotation goes to the end of the document
      i++
    ) {
      const position = this.annotationList.getPosition(i);
      const data = this.annotationList.getByPosition(position)!;

      const annotationsOfType = data.get(annotation.type) || [];
      const updatedAnnotations = annotationsOfType.filter(
        (s) => s.id !== annotation.id
      );

      if (updatedAnnotations.length > 0) {
        data.set(annotation.type, updatedAnnotations);
      } else {
        data.delete(annotation.type);
      }
    }

    // Emit the removal event
    this.emit("AnnotationRemoved", {
      startIndex: annotation.startPosition
        ? this.text.indexOfPosition(annotation.startPosition, "left")
        : 0,
      endIndex: annotation.endPosition
        ? this.text.indexOfPosition(annotation.endPosition, "right")
        : this.text.length,
      meta,
      reason,
      annotation,
      author,
    });
  }

  /**
   * Returns the currently applied annotations at a given text position.
   * Open endings are not formatted and thus not included in the returned data.
   *
   * If position is not currently present, returns the formatting that a character
   * at the position would have if present...
   * @param position
   */
  private getAnnotationsInternal(
    position: Position
  ): AdditionAnnotation[] | null {
    const index = this.text.indexOfPosition(position, "left");

    const dataIndex = this.annotationList.indexOfPosition(
      position,
      index === 0 ? "right" : "left"
    );

    if (
      dataIndex === -1 ||
      (index === 0 && dataIndex === this.annotationList.length)
    ) {
      return null;
    }

    const dataPos = this.annotationList.getPosition(dataIndex);
    const data = this.annotationList.getByPosition(dataPos);
    if (!data) return null;
    // Flatten all annotation arrays and
    const annotations = Array.from(data.values())
      .flat()
      .filter(
        (s) =>
          (dataPos !== position && !s.endingHere) ||
          (!s.endingHere && !s.startingHere) ||
          (dataPos === position &&
            s.startingHere &&
            s.startClosed &&
            !s.endingHere) ||
          (s.endingHere && s.endClosed && dataPos === position)
      ); // only allow annotations that are not ending here or are ending here and have an endClosed flag
    return annotations.length > 0 ? annotations : null;
  }

  /**
   * As stated in the peritext paper, whenever a format (here: annotation) changes,
   * there is a datapoint at that position with all currently and onwards applied format data.
   *
   * This function creates such a data point if it doesn't already exists, inferring the
   * still applied data from the previous data point.
   * @param position The position where to create a data point
   */
  private createDataPoint(position: Position): void {
    if (this.annotationList.hasPosition(position)) return;

    // Gets the next available index of a datapoint to the left. Returns -1 if none is found
    const prevIndex = this.annotationList.indexOfPosition(position, "left");
    if (prevIndex === -1) {
      this.annotationList.set(position, new Map());
    } else {
      const prev = Array.from(this.annotationList.get(prevIndex).values())
        .flat()
        .filter((s) => !s.endingHere) // Dont copy endingHere annotations
        .reduce((acc, s) => {
          if (!acc.has(s.type)) {
            acc.set(s.type, []);
          }
          acc.get(s.type)!.push({ ...s, endingHere: false }); // Copy the annotation without endingHere
          return acc;
        }, new Map<AnnotationType, (AdditionAnnotation & { endingHere: boolean; startingHere: boolean })[]>());

      this.annotationList.set(position, new Map(prev));
    }
  }

  /**
   * copied from https://github.com/composablesys/collabs/blob/1063c40e98034c0c4767aa79e1d3955424ba1c47/crdts/src/list/c_rich_text.ts#L444
   *
   * Returns whether annotationA wins over annotationB, either in the Lamport
   * order (with senderID tiebreaker) or because
   * annotationB is undefined.
   *
   * If annotationA and annotationB come from the same transaction, this also
   * returns true. That is okay because we always call wins() in transaction order,
   * and later annotations in the same transaction win over
   * earlier annotations.
   */
  private wins(
    annotationA: Annotation,
    annotationB: Annotation | undefined
  ): boolean {
    if (annotationB === undefined) return true;
    if (annotationA.lamport > annotationB.lamport) return true;
    if (annotationA.lamport === annotationB.lamport) {
      // In === case, the two annotations come from the same transaction,
      // but annotationA is newer (a later message in the same transaction).
      if (annotationA.senderID >= annotationB.senderID) return true;
    }
    return false;
  }

  /**
   * Inserts a string of characters at a given index.
   *
   * @param index The position where to insert the new characters.
   * @param values The string of characters to insert.
   * @param isSuggestion If true, the inserted text is marked as an insertion suggestion.
   * If a suggestion from the same user already exists at the insertion point, the new text is appended to it.
   * If false, the text is inserted directly as normal content.
   */
  insert(index: number, values: string, isSuggestion: boolean): void {
    if (values.length === 0) return;
    this.text.insert(index, ...values);

    const startPos = this.text.getPosition(index);
    const existing = this.getAnnotationsInternal(startPos);

    if (existing) {
      // Update the existing annotation to shrink it
      for (const annotation of existing.filter(
        (s) =>
          (isSuggestion &&
            s.description === AnnotationDescription.INSERT_SUGGESTION &&
            s.userId !== this.userId) ||
          (!isSuggestion &&
            s.description === AnnotationDescription.INSERT_SUGGESTION)
      )) {
        const isOnLeftEdge =
          annotation.startPosition &&
          this.text.indexOfPosition(annotation.startPosition, "left") + 1 ===
            index; // +1 because we have an open start
        const isOnRightEdge =
          annotation.endPosition &&
          this.text.indexOfPosition(annotation.endPosition, "right") - 1 ===
            index; // -1 because we have an open end

        const isOnAbsoluteStart = !annotation.startPosition && index === 0;

        const isOnAbsoluteEnd =
          !annotation.endPosition && index === this.text.length - 1;

        this.annotationLog.add({
          dependentOn: annotation.id,
          type: AnnotationType.SUGGESTION,
          action: AnnotationAction.UPDATE,
          updatedProperties: {
            ...((isOnLeftEdge || isOnAbsoluteStart) && {
              startPosition: index >= 0 ? this.text.getPosition(index) : null,
            }),
            ...((isOnRightEdge || isOnAbsoluteEnd) && {
              endPosition:
                index + values.length - 1 < this.text.length
                  ? this.text.getPosition(index + values.length - 1)
                  : null,
            }),
          },
        } as UpdateAnnotation);
      }
    }

    // If the insertion is a annotation and not part of an existing insertion
    // annotation of the same user, create a new annotation
    if (
      isSuggestion &&
      !(
        existing &&
        existing.filter(
          (s) =>
            s.description === AnnotationDescription.INSERT_SUGGESTION &&
            s.userId === this.userId
        ).length > 0
      )
    ) {
      // This is the char after the insertion, so that we can model a growing range (i.e. open end)
      const endPos =
        index + values.length === this.text.length
          ? null
          : this.text.getPosition(index + values.length);

      // This is the char before the insertion, so that we can model a growing range (i.e. open start)
      const actualStartPos =
        index - 1 >= 0 ? this.text.getPosition(index - 1) : null;

      this.annotationLog.add({
        type: AnnotationType.SUGGESTION,
        action: AnnotationAction.ADDITION,
        description: AnnotationDescription.INSERT_SUGGESTION,
        startPosition: actualStartPos,
        endPosition: endPos,
        endClosed: false,
        startClosed: false,
        userId: this.userId,
      } as AdditionAnnotation);
    }
  }

  /**
   * Returns an array of all currently active annotations.
   * This includes all suggestions and comments.
   *
   * @returns An array of active addition annotations.
   */
  public getActiveAnnotations(): AdditionAnnotation[] {
    const annotations = new Map<AnnotationId, AdditionAnnotation>();

    for (const [_index, dataPoint] of this.annotationList.entries()) {
      const allAnnotationsAtPosition = Array.from(dataPoint.values()).flat();

      for (const annotation of allAnnotationsAtPosition) {
        if (
          annotation.action === AnnotationAction.ADDITION &&
          !annotations.has(annotation.id)
        ) {
          annotations.set(annotation.id, annotation);
        }
      }
    }

    return Array.from(annotations.values());
  }

  /**
   * Deletes a number of characters starting from a given index.
   *
   * @param index The starting position of the deletion.
   * @param count The number of characters to delete.
   * @param isSuggestion If true, the characters are not removed directly. Instead, a deletion
   * suggestion is created to mark them as deleted. If the deleted range is fully inside an
   * insertion suggestion of the same user, the characters are deleted directly.
   * If false, the characters are permanently removed.
   */
  delete(index: number, count: number, isSuggestion: boolean) {
    // Case 1: Not a annotation, just delete the text and exit.
    if (!isSuggestion) {
      this.text.delete(index, count);
      return;
    }

    // Case 2: The deletion occurs entirely within a single insertion annotation
    // from the same user. In this case, the text is deleted directly.
    if (this.isRangeWithinSameInsertion(index, count, this.userId)) {
      this.text.delete(index, count);
      return;
    }

    // Case 3: Create a new delete annotation
    this.createDeleteAnnotation(index, count);
  }

  /**
   * Checks if a range (from index to index + count) is fully contained
   * within a single INSERT_SUGGESTION from a single user.
   * "Same annotation" is identified by matching lamport and senderId.
   * @returns True if the deletion is within the same user's single insertion.
   */
  private isRangeWithinSameInsertion(
    index: number,
    count: number,
    userId: string
  ): boolean {
    if (count <= 0) {
      return false;
    }

    const startPos = this.text.getPosition(index);
    const endPos = this.text.getPosition(index + count - 1);

    // Get all relevant user insertion annotations at the start of the deletion.
    const insertionsAtStart = (
      this.getAnnotationsInternal(startPos) || []
    ).filter(
      (s) =>
        s.description === AnnotationDescription.INSERT_SUGGESTION &&
        s.userId === userId
    );

    // If there are no user insertions at the start, we can stop early.
    if (insertionsAtStart.length === 0) {
      return false;
    }

    // For efficiency, create a lookup Set of unique identifiers for the annotations
    // found at the start
    const startAnnotationIds = new Set(insertionsAtStart.map((s) => s.id));

    // Get all relevant user insertion annotations at the end of the deletion.
    const insertionsAtEnd = (this.getAnnotationsInternal(endPos) || []).filter(
      (s) =>
        s.description === AnnotationDescription.INSERT_SUGGESTION &&
        s.userId === userId
    );

    // Check if any annotation at the end position also exists in our start set.
    // This confirms the deletion range is bounded by the same annotation.
    return insertionsAtEnd.some((endAnnotation) =>
      startAnnotationIds.has(endAnnotation.id)
    );
  }

  /**
   * Creates a new delete annotation. If adjacent delete annotations
   * from the same user are present, the annotation grows by their size
   * (i.e. "they get merged")
   */
  private createDeleteAnnotation(index: number, count: number) {
    // Find the most relevant adjacent delete annotation before the deletion.
    let relevantAnnotation = this.findDeleteAnnotation(
      index > 0 ? this.text.getPosition(index - 1) : null
    );
    let rightGrowing = true; // If we found a previous annotation, this annotation now grows to the right.

    if (!relevantAnnotation) {
      // If no previous annotation is found, check if the next position has a relevant annotation.
      relevantAnnotation =
        index + count < this.text.length
          ? this.findDeleteAnnotation(this.text.getPosition(index + count))
          : undefined;
      rightGrowing = false; // If we found a next annotation, this annotation now grows to the left.
    }

    console.log("Relevant Annotation", relevantAnnotation);

    // When a adjacent annotation is present, we need to create an updated annotation
    // that lets the new annotation grow to the left or right.
    if (relevantAnnotation) {
      this.annotationLog.add({
        type: AnnotationType.SUGGESTION,
        action: AnnotationAction.UPDATE,
        userId: this.userId,
        updatedProperties: {
          ...(rightGrowing && {
            endPosition: this.text.getPosition(index + count - 1),
          }),
          ...(!rightGrowing && {
            startPosition: this.text.getPosition(index),
          }),
        },
        dependentOn: relevantAnnotation.id,
      } as UpdateAnnotation);
      return;
    }

    // Create the annotation with the determined positions.
    // This call is now identical for all cases.
    this.annotationLog.add({
      type: AnnotationType.SUGGESTION,
      action: AnnotationAction.ADDITION,
      description: AnnotationDescription.DELETE_SUGGESTION,
      startPosition: this.text.getPosition(index),
      endPosition: this.text.getPosition(index + count - 1), // The end position is inclusive, so we need to subtract 1 from the index
      endClosed: true,
      startClosed: true,
      userId: this.userId,
    } as AdditionAnnotation);
  }

  /**
   * Finds a delete annotation at a given position.
   * @param position The position at which to search. If null, nothing will be found.
   * @returns The found annotation or undefined.
   */
  private findDeleteAnnotation(
    position: Position | null
  ): AdditionAnnotation | undefined {
    if (!position) {
      return undefined;
    }

    console.log("Searching for delete annotation at", position);

    const candidates = (this.getAnnotationsInternal(position) || []).filter(
      (s) =>
        s.description === AnnotationDescription.DELETE_SUGGESTION &&
        s.userId === this.userId
    );

    if (candidates.length === 0) {
      return undefined;
    }

    return candidates[0];
  }

  /**
   * Accepts a suggestion.
   * If it is an insertion suggestion, the text becomes normal content.
   * If it is a deletion suggestion, the marked text is permanently deleted.
   *
   * @param id The ID of the annotation to accept.
   */
  acceptSuggestion(id: AnnotationId) {
    const history = this.annotationLog.log.get(id);

    const found = history?.find(
      (s) => s.action === AnnotationAction.ADDITION
    ) as AdditionAnnotation | undefined;

    const existing = found
      ? (this.applyUpdateOperations(found, history || []) as
          | AdditionAnnotation
          | undefined)
      : undefined;

    this.annotationLog.add({
      type: AnnotationType.SUGGESTION,
      description: AnnotationDescription.ACCEPT_SUGGESTION,
      action: AnnotationAction.REMOVAL,
      userId: this.userId,
      dependentOn: id,
    } as RemovalAnnotation);

    if (
      existing &&
      existing.description === AnnotationDescription.DELETE_SUGGESTION
    ) {
      const startPosition = existing.startPosition
        ? existing.startPosition
        : this.text.getPosition(0);

      const endPosition = existing.endPosition
        ? existing.endPosition
        : this.text.getPosition(this.text.length - 1);

      this.text.deleteRange(startPosition, endPosition);
    }
  }

  /**
   * Declines a suggestion.
   * If it is an insertion suggestion, the suggested text is deleted.
   * If it is a deletion suggestion, only the marking is removed and the text remains.
   *
   * @param id The ID of the annotation to decline.
   */
  declineSuggestion(id: AnnotationId) {
    const history = this.annotationLog.log.get(id);

    const found = history?.find(
      (s) => s.action === AnnotationAction.ADDITION
    ) as AdditionAnnotation | undefined;

    const existing = found
      ? (this.applyUpdateOperations(found, history || []) as
          | AdditionAnnotation
          | undefined)
      : undefined;

    this.annotationLog.add({
      type: AnnotationType.SUGGESTION,
      action: AnnotationAction.REMOVAL,
      description: AnnotationDescription.DECLINE_SUGGESTION,
      userId: this.userId,
      dependentOn: id,
    } as RemovalAnnotation);

    if (
      existing &&
      existing.description === AnnotationDescription.INSERT_SUGGESTION
    ) {
      const startIndex = existing.startPosition
        ? this.text.indexOfPosition(existing.startPosition, "left")
        : -1; // -1 because we have an open start and the annotation is practically fixed to the character before the insertion (char 0)

      const startPosition = this.text.getPosition(startIndex + 1); // +1 because we have an open start

      const endIndex =
        (existing.endPosition
          ? this.text.indexOfPosition(existing.endPosition, "right")
          : this.text.length) - 1; // -1 because we have an open end

      const endPosition = this.text.getPosition(endIndex);

      this.text.deleteRange(startPosition, endPosition);
    }
  }

  /**
   * Adds a comment to a specific range of text.
   *
   * @param startIndex The starting index of the text range (inclusive).
   * @param endIndex The ending index of the text range (inclusive).
   * @param comment The content of the comment.
   * @throws If startIndex or endIndex are out of bounds or if endIndex is smaller than startIndex.
   */
  addComment(startIndex: number, endIndex: number, comment: string) {
    if (startIndex < 0 || startIndex >= this.length) {
      throw new Error(
        `startIndex out of bounds: ${startIndex} (length: ${this.length})`
      );
    }
    if (endIndex < 0 || endIndex > this.length) {
      throw new Error(
        `endIndex out of bound: ${endIndex} (length: ${this.length})`
      );
    }
    if (endIndex < startIndex) {
      throw new Error(
        `endIndex ${endIndex} is less than startIndex ${startIndex}`
      );
    }

    this.annotationLog.add({
      type: AnnotationType.COMMENT,
      action: AnnotationAction.ADDITION,
      description: AnnotationDescription.ADD_COMMENT,
      endClosed: true,
      startClosed: true,
      userId: this.userId,
      startPosition: this.text.getPosition(startIndex),
      endPosition: this.text.getPosition(endIndex),
      value: comment,
    } as AdditionAnnotation);
  }

  /**
   * Removes a comment from the document.
   *
   * @param id The ID of the comment to remove.
   */
  removeComment(id: AnnotationId) {
    this.annotationLog.add({
      type: AnnotationType.COMMENT,
      action: AnnotationAction.REMOVAL,
      description: AnnotationDescription.REMOVE_COMMENT,
      userId: this.userId,
      dependentOn: id,
    } as RemovalAnnotation);
  }

  /**
   * Returns a section of this text string,
   * with behavior like
   * [String.slice](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/slice).
   */
  slice(start?: number, end?: number): string {
    return this.text.slice(start, end).join("");
  }

  /**
   * @return The position currently at index.
   */
  getPosition(index: number): Position {
    return this.text.getPosition(index);
  }

  /**
   * Returns the current index of position.
   *
   * If position is not currently present in the list
   * ([[hasPosition]] returns false), then the result depends on searchDir:
   * - "none" (default): Returns -1.
   * - "left": Returns the next index to the left of position.
   * If there are no values to the left of position,
   * returns -1.
   * - "right": Returns the next index to the right of position.
   * If there are no values to the left of position,
   * returns [[length]].
   */
  indexOfPosition(
    position: Position,
    searchDir?: "none" | "left" | "right"
  ): number {
    return this.text.indexOfPosition(position, searchDir);
  }

  /**
   * Returns whether position is currently present in the list,
   * i.e., its value is present.
   */
  hasPosition(position: Position): boolean {
    return this.text.hasPosition(position);
  }

  /**
   * Returns the value at position, or undefined if it is not currently present
   * ([[hasPosition]] returns false).
   */
  getByPosition(position: Position): string | undefined {
    return this.text.getByPosition(position);
  }

  /** Returns an iterator for present positions, in list order. */
  positions(): IterableIterator<Position> {
    return this.text.positions();
  }

  /**
   * The abstract total order underlying this text CRDT.
   *
   * Access this to construct separate [[LocalList]] views on top of
   * the same total order.
   */
  get totalOrder(): CTotalOrder {
    return this.text.totalOrder;
  }

  /**
   * Returns the plain text as an ordinary string.
   */
  toString(): string {
    return this.text.slice().join("");
  }

  /**
   * Deletes every character in the text string.
   */
  clear() {
    this.text.clear();
  }

  /**
   * Returns a string consisting of the single character
   * (UTF-16 codepoint) at `index`.
   *
   * @throws If index is not in `[0, this.length)`.
   * Note that this differs from an ordinary string,
   * which would instead return an empty string.
   */
  charAt(index: number): string {
    return this.text.get(index);
  }
}
