import {
  CObject,
  CollabEvent,
  CollabEventsRecord,
  CTotalOrder,
  CValueList,
  ICursorList,
  InitToken,
  LocalList,
  Position,
  TextEvent,
  UpdateMeta,
} from "@collabs/collabs";
import {
  Annotation,
  AnnotationAction,
  AnnotationDescription,
  AnnotationId,
  AnnotationType,
  CAnnotationLog,
} from "./c_annotation";

export interface TrackChangesTextInsertEvent extends TextEvent {
  annotations: null | Annotation[];
}

export interface TrackChangesFormatEvent extends CollabEvent {
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
   * The author of that change, e.g:
   * - when inserting a new suggestion: The user who wrote the text in suggestion mode
   * - when accepting a suggestion: The user, who accepted the suggestion
   */
  author: string;
  /**
   * The old annotation of the given range. Undefined for text that is written in editmode and not in an existing annotation.
   */
  oldAnnotation: Annotation | undefined;
  /**
   * The range's complete new annotation. Undefined when the oldAnnotation just got removed.
   */
  newAnnotation: Annotation | undefined;
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
   * When a range grows, it replaces the old and shorter range. If the addition is
   * due to a range growing, this is the id of the range it replaces. Else,
   * this is undefined.
   */
  replacement: AnnotationId | undefined;
  /**
   * The new annotation
   */
  annotation: Annotation;
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
  annotation: Annotation;
}

export interface TrackChangesEventsRecord extends CollabEventsRecord {
  Insert: TrackChangesTextInsertEvent;
  Delete: TextEvent;
  FormatChange: TrackChangesFormatEvent;
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
  (Annotation & { endingHere: boolean })[]
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
  private readonly text: CValueList<string>;
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
      (init) => new CValueList<string>(init)
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
    // ---- Step 1: Prepare local state (create data points at the start and end) ----
    this.createDataPoint(annotation.startPosition);
    if (annotation.endPosition) this.createDataPoint(annotation.endPosition);

    const startIndex = this.annotationList.indexOfPosition(
      annotation.startPosition
    );
    const endIndex =
      annotation.endPosition === null
        ? null // If the annotation is open ended an goes to the end of the document, no ending should be set
        : this.annotationList.indexOfPosition(annotation.endPosition);

    console.log(`Looking trough positions from ${startIndex} to ${endIndex}`);

    // ---- Step 2: Iterate over the affected range and collect changes ----

    // The collected changes. This includes
    //
    // - the actual changes of formatting (e.g. if a char is normal text(no annotation) and is
    // inbetween a annotation-decline range, there is no change
    // on this particular character and thus it should not be included in
    // an UI event)
    //
    // - the addition of annotations
    //
    // - the ui-relevant removal of annotations (i.e. if a range grows, it is
    // replaced with bigger ranges instead of actually mutated the old range is kept.
    // But this is not relevant to the ui, the change relevant for the ui is, that
    // the shorter range is removed and the longer range is inserted.)
    const changes: AggregatedChange[] = [];

    console.log(
      "the annotationList is",
      Array.from(this.annotationList.entries())
    );

    // Go trough all datapoints in the givdocumentStore.addComment()en range and add the new annotation.
    // If there are existing annotations that are mutually exclusive with the
    // new annotation (i.e. addition with a corresponding removal), remove
    // them, and discard the annotation
    for (
      let i = startIndex;
      i <= (endIndex !== null ? endIndex : this.annotationList.length - 1); // If no end index is set, the annotation goes to the end of the document
      i++
    ) {
      const position = this.annotationList.getPosition(i);
      const data = this.annotationList.getByPosition(position)!;
      const isEnd = i === endIndex;

      const change = this.updateDataPointAndCollectChanges(
        data,
        annotation,
        isEnd
      );

      if (change) {
        changes.push({ ...change, position });
      }
    }

    // ---- Step 3: Emit events based on the collected changes ----
    if (changes.length > 0) {
      this.emitEventsFromChanges(changes, annotation.userId, meta);
    }
  }

  /**
   * The core logic for a single data point. It mutates the data point
   * and returns a summary of what changed.
   *
   * @param data The AnnotationDataPoint to update.
   * @param newAnnotation The annotation causing the change.
   * @param isEnd Whether this is the last data point in the range.
   * @returns An object summarizing the changes, or null if no change occurred.
   */
  private updateDataPointAndCollectChanges(
    data: AnnotationDataPoint,
    newAnnotation: Annotation,
    isEnd: boolean
  ): Omit<AggregatedChange, "position"> | null {
    // All annotations of the same type as the new annotation on that position
    const annotationsOfType = data.get(newAnnotation.type) || [];

    const removedAnnotations: AnnotationRemoveInfo[] = [];
    let addedAnnotation: AnnotationAdditionInfo | null = null;

    let textAction: TextAction | null = null;
    let oldFormat: Annotation | undefined = undefined;
    let newFormat: Annotation | undefined = undefined;

    const corresponding = annotationsOfType.find(
      (s) =>
        // Get all annotations with the other action (e.g. addition -> removal)
        newAnnotation.action !== s.action &&
        // Get only annotations that reference the new action or are referenced by it
        // (e.g. the acceptance of a annotation only removes the annotation that it references)
        (s.dependentOn === newAnnotation.id ||
          newAnnotation.dependentOn === s.id)
    );

    if (!corresponding) {
      // Case 1: No direct interaction between existing and new annotation, the new annotation is added.
      // Check if it replaces an existing annotation (e.g., growing a delete range).
      const existing = annotationsOfType.find(
        (s) =>
          s.description === AnnotationDescription.DELETE_SUGGESTION && // Only deleting ranges can be replaced
          s.userId === newAnnotation.userId &&
          s.description === newAnnotation.description &&
          this.wins(newAnnotation, s)
      ); // This is not commutative, it should be the longest existing range instead of the first. But that would be to expensive to calculate each time, so I hope it works like that too

      const replacementId = existing ? existing.id : undefined;
      if (existing) {
        removedAnnotations.push(
          ...annotationsOfType
            .filter(
              (s) =>
                s.userId === newAnnotation.userId &&
                s.description === newAnnotation.description
            )
            .map((s) => ({
              prev: s,
              reason: AnnotationRemovalReason.REPLACED,
            }))
        );
      }

      data.set(newAnnotation.type, [
        ...annotationsOfType.filter((s) => s !== existing),
        { ...newAnnotation, endingHere: isEnd },
      ]);

      addedAnnotation = { new: newAnnotation, replacement: replacementId };

      // A format change only occurs if the range is affected and it wasn't
      // just a replacement of a visually identical annotation.
      if (!existing && (newAnnotation.endClosed || !isEnd)) {
        oldFormat = undefined;
        newFormat = newAnnotation;
      }
    } else {
      // Case 2: Interaction detected (e.g., accept/decline).
      const removalAnnotation =
        newAnnotation.action === AnnotationAction.REMOVAL
          ? newAnnotation
          : corresponding;
      const otherAnnotation =
        newAnnotation === removalAnnotation ? corresponding : newAnnotation;

      if (this.wins(removalAnnotation, otherAnnotation)) {
        // The removal wins, so the `otherAnnotation` (which is an ADDITION) is removed.
        data.set(
          newAnnotation.type,
          annotationsOfType.filter((s) => s.id !== corresponding.id)
        );

        const reason =
          removalAnnotation.description ===
          AnnotationDescription.DECLINE_SUGGESTION
            ? AnnotationRemovalReason.DECLINED
            : AnnotationRemovalReason.ACCEPTED;
        removedAnnotations.push({ prev: corresponding, reason });

        // A format change occurs if the removed annotation was affecting the format.
        if (corresponding.action === AnnotationAction.ADDITION) {
          oldFormat = corresponding;
          newFormat = undefined;
        }

        // Check for text-deleting side-effects.
        if (
          reason === AnnotationRemovalReason.ACCEPTED &&
          corresponding.description === AnnotationDescription.DELETE_SUGGESTION
        ) {
          textAction = {
            type: "delete",
            startPosition: corresponding.startPosition,
            endPosition: corresponding.endPosition,
          };
        }
      }
    }

    if (removedAnnotations.length === 0 && !addedAnnotation) {
      return null;
    }

    return {
      removedAnnotations,
      addedAnnotation,
      oldFormat,
      newFormat,
      textAction,
    };
  }

  /**
   * Takes a list of granular changes and emits the required, user-facing events.
   * This method handles coalescing of format changes and deduplication of other events.
   *
   * @param changes A list of all changes that occurred.
   * @param author The author of the top-level change.
   * @param meta The update metadata.
   */
  private emitEventsFromChanges(
    changes: AggregatedChange[],
    author: string,
    meta: UpdateMeta
  ) {
    // --- 1. Emit AnnotationAdded and AnnotationRemoved events (deduplicated) ---
    const addedMap = new Map<AnnotationId, AnnotationAdditionInfo>();
    const removedMap = new Map<AnnotationId, AnnotationRemoveInfo>();

    for (const change of changes) {
      if (change.addedAnnotation) {
        addedMap.set(change.addedAnnotation.new.id, change.addedAnnotation);
      }
      for (const removed of change.removedAnnotations) {
        removedMap.set(removed.prev.id, removed);
      }
    }

    for (const added of addedMap.values()) {
      const startIndex = this.text.indexOfPosition(
        added.new.startPosition,
        "left"
      );
      const endIndex = added.new.endPosition
        ? this.text.indexOfPosition(added.new.endPosition, "right")
        : this.text.length;

      this.emit("AnnotationAdded", {
        meta,
        startIndex,
        endIndex,
        replacement: added.replacement,
        annotation: added.new,
      });
    }

    for (const removed of removedMap.values()) {
      const startIndex = this.text.indexOfPosition(
        removed.prev.startPosition,
        "left"
      );
      const endIndex = removed.prev.endPosition
        ? this.text.indexOfPosition(removed.prev.endPosition, "right")
        : this.text.length;

      this.emit("AnnotationRemoved", {
        startIndex,
        endIndex,
        meta,
        author,
        reason: removed.reason,
        annotation: removed.prev,
      });
    }

    // --- 2. Emit FormatChange events (coalesced) ---
    const formatChanges = changes
      .filter((c) => c.oldFormat !== undefined || c.newFormat !== undefined)
      .map((c) => ({
        index: this.text.indexOfPosition(c.position),
        oldAnnotation: c.oldFormat,
        newAnnotation: c.newFormat,
      }))
      .sort((a, b) => a.index - b.index);

    if (formatChanges.length === 0) return;

    let currentGroup = [formatChanges[0]];
    for (let i = 1; i < formatChanges.length; i++) {
      const prev = formatChanges[i - 1];
      const curr = formatChanges[i];
      const isContiguous = curr.index === prev.index + 1;
      const isSameChange =
        curr.oldAnnotation?.id === prev.oldAnnotation?.id &&
        curr.newAnnotation?.id === prev.newAnnotation?.id;

      if (isContiguous && isSameChange) {
        currentGroup.push(curr);
      } else {
        // Emit for the completed group
        const first = currentGroup[0];
        const last = currentGroup[currentGroup.length - 1];
        this.emit("FormatChange", {
          startIndex: first.index,
          endIndex: last.index, // TODO check if inclusive ending behaves always correct
          author,
          oldAnnotation: first.oldAnnotation,
          newAnnotation: first.newAnnotation,
          meta,
        });
        // Start a new group
        currentGroup = [curr];
      }
    }
    // Emit the last group
    const first = currentGroup[0];
    const last = currentGroup[currentGroup.length - 1];
    this.emit("FormatChange", {
      startIndex: first.index,
      endIndex: last.index, // TODO check if inclusive ending behaves always correct
      author,
      oldAnnotation: first.oldAnnotation,
      newAnnotation: first.newAnnotation,
      meta,
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
  private getAnnotationsInternal(position: Position): Annotation[] | null {
    const dataIndex = this.annotationList.indexOfPosition(position, "left");
    if (dataIndex === -1) {
      return null;
    }

    const dataPos = this.annotationList.getPosition(dataIndex);
    console.log(
      `Getting annotations at position ${dataPos} for position ${position}`
    );
    const data = this.annotationList.getByPosition(dataPos);
    if (!data) return null;
    // Flatten all annotation arrays and
    const annotations = Array.from(data.values())
      .flat()
      .filter(
        (s) =>
          !s.endingHere || (dataPos === position && s.endingHere && s.endClosed)
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
        }, new Map<AnnotationType, (Annotation & { endingHere: boolean })[]>());

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

  insert(index: number, values: string, isAnnotation: boolean): void {
    if (values.length === 0) return;
    this.text.insert(index, ...values);

    const startPos = this.text.getPosition(index);
    const existing = this.getAnnotationsInternal(startPos);

    // If the insertion is a annotation and not part of an existing insertion
    // annotation of the same user, create a new annotation
    if (
      isAnnotation &&
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

      this.annotationLog.add({
        type: AnnotationType.SUGGESTION,
        action: AnnotationAction.ADDITION,
        description: AnnotationDescription.INSERT_SUGGESTION,
        startPosition: startPos,
        endPosition: endPos,
        endClosed: false,
        userId: this.userId,
      });
    }
  }

  /**
   * Returns all currently active and for the UI relevant annotations.
   * E.g. if there are multiple delete annotations from the same user,
   * only the latest one is returned.
   * @returns
   */
  public getActiveAnnotations(): Annotation[] {
    const annotationTraces = new Map<
      AnnotationId,
      { annotation: Annotation & { endingHere: boolean }; position: Position }[]
    >();

    for (const [_index, dataPoint, position] of this.annotationList.entries()) {
      const allAnnotationsAtPosition = Array.from(dataPoint.values()).flat();

      const deleteAnnotationsByUser = new Map<
        string,
        (Annotation & { endingHere: boolean })[]
      >();
      const otherAnnotations: (Annotation & { endingHere: boolean })[] = [];

      for (const s of allAnnotationsAtPosition) {
        if (s.description === AnnotationDescription.DELETE_SUGGESTION) {
          if (!deleteAnnotationsByUser.has(s.userId)) {
            deleteAnnotationsByUser.set(s.userId, []);
          }
          deleteAnnotationsByUser.get(s.userId)!.push(s);
        } else {
          otherAnnotations.push(s);
        }
      }

      const winningDeleteAnnotations: (Annotation & {
        endingHere: boolean;
      })[] = [];
      for (const userAnnotations of deleteAnnotationsByUser.values()) {
        if (userAnnotations.length > 0) {
          // Die 'wins'-Methode ermittelt den neuesten Vorschlag basierend auf Lamport-Zeitstempeln.
          const winner = userAnnotations.reduce((a, b) =>
            this.wins(a, b) ? a : b
          );
          winningDeleteAnnotations.push(winner);
        }
      }

      const filteredAnnotations = [
        ...otherAnnotations,
        ...winningDeleteAnnotations,
      ].filter((s) => s.action === AnnotationAction.ADDITION);

      for (const s of filteredAnnotations) {
        if (!annotationTraces.has(s.id)) {
          annotationTraces.set(s.id, []);
        }
        annotationTraces.get(s.id)!.push({
          annotation: s,
          position,
        });
      }
    }

    const finalAnnotations: Annotation[] = [];
    for (const traces of annotationTraces.values()) {
      const startPosition = traces[0].position;
      const definitiveAnnotationData = traces[traces.length - 1].annotation;
      const endTrace = traces.find((trace) => trace.annotation.endingHere);

      const reconstructedAnnotation: Annotation = {
        ...definitiveAnnotationData,
        startPosition: startPosition,
        endPosition: endTrace ? endTrace.position : null,
      };

      delete (reconstructedAnnotation as any).endingHere;
      finalAnnotations.push(reconstructedAnnotation);
    }

    return finalAnnotations;
  }

  delete(index: number, count: number, isAnnotation: boolean) {
    // Case 1: Not a annotation, just delete the text and exit.
    if (!isAnnotation) {
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
    console.log(
      `Creating delete annotation at index ${index} with count ${count}`
    );

    // Find the "outermost" previous and next delete annotations.
    const prevAnnotation = this.findAdjacentDeleteAnnotation(
      index > 0 ? this.text.getPosition(index - 1) : null,
      "previous"
    );
    const nextAnnotation =
      index + count < this.text.length
        ? this.findAdjacentDeleteAnnotation(
            this.text.getPosition(index + count),
            "next"
          )
        : undefined;

    // Determine the final start and end positions for the new/merged annotation.
    const finalStartPosition = prevAnnotation
      ? prevAnnotation.startPosition
      : this.text.getPosition(index);

    const endOfDeletionIndex = index + count - 1;
    let finalEndPosition = this.text.getPosition(endOfDeletionIndex);

    if (nextAnnotation?.endPosition) {
      const nextAnnotationEndIndex = this.text.indexOfPosition(
        nextAnnotation.endPosition
      );
      // If the adjacent annotation extends further than the current deletion,
      // adopt its endpoint to merge them.
      if (nextAnnotationEndIndex > endOfDeletionIndex) {
        finalEndPosition = nextAnnotation.endPosition;
      }
    }

    // Create the annotation with the determined positions.
    // This call is now identical for all cases.
    this.annotationLog.add({
      type: AnnotationType.SUGGESTION,
      action: AnnotationAction.ADDITION,
      description: AnnotationDescription.DELETE_SUGGESTION,
      startPosition: finalStartPosition,
      endPosition: finalEndPosition,
      endClosed: true,
      userId: this.userId,
    });
  }

  /**
   * Finds the most relevant adjacent delete annotation at a given position.
   * The most relevant are the biggest delete annotations of the same user
   * @param position The position at which to search. If null, nothing will be found.
   * @param direction 'previous' looks for the annotation with the earliest start, 'next' for the one with the latest end.
   * @returns The found annotation or undefined.
   */
  private findAdjacentDeleteAnnotation(
    position: Position | null,
    direction: "previous" | "next"
  ): Annotation | undefined {
    if (!position) {
      return undefined;
    }

    const candidates = (this.getAnnotationsInternal(position) || []).filter(
      (s) =>
        s.description === AnnotationDescription.DELETE_SUGGESTION &&
        s.userId === this.userId
    );

    console.log(
      `Found ${candidates.length} candidates for ${direction} delete annotation at position ${this.text.indexOfPosition(position)}`,
      candidates
    );

    if (candidates.length === 0) {
      return undefined;
    }

    // Instead of sorting the entire array, we find the best element directly.
    // This is more efficient when you only need to find an extremum.
    return candidates.reduce((best, current) => {
      if (direction === "previous") {
        // Find the annotation that starts the earliest.
        const bestIndex = this.text.indexOfPosition(best.startPosition);
        const currentIndex = this.text.indexOfPosition(current.startPosition);

        console.log(
          `Comparing ${bestIndex} with ${currentIndex} for previous direction`
        );

        return currentIndex < bestIndex ? current : best;
      } else {
        // direction === 'next'
        // Find the annotation that ends the latest.
        const bestEndIndex = best.endPosition
          ? this.text.indexOfPosition(best.endPosition)
          : -1;
        const currentEndIndex = current.endPosition
          ? this.text.indexOfPosition(current.endPosition)
          : -1;

        console.log(
          `Comparing ${bestEndIndex} with ${currentEndIndex} for next direction`
        );

        return currentEndIndex > bestEndIndex ? current : best;
      }
    });
  }

  // TODO: Position is only needed for performance reasons. Maybe find a better approach?
  acceptSuggestion(position: Position, id: AnnotationId) {
    const data = this.annotationList.getByPosition(position);

    const existing = Array.from(data?.values() || [])
      .flat()
      .find((s) => s.id === id && s.action === AnnotationAction.ADDITION);

    if (!existing) {
      throw new Error("No annotation with this id at this position found.");
    }

    this.annotationLog.add({
      type: AnnotationType.SUGGESTION,
      action: AnnotationAction.REMOVAL,
      description: AnnotationDescription.ACCEPT_SUGGESTION,
      endClosed: existing.endClosed,
      userId: this.userId,
      dependentOn: existing.id,
      startPosition: existing.startPosition,
      endPosition: existing.endPosition,
    });

    if (existing.description === AnnotationDescription.DELETE_SUGGESTION) {
      this.text.delete(
        this.text.indexOfPosition(existing.startPosition),
        (existing.endPosition
          ? this.text.indexOfPosition(existing.endPosition, "left")
          : this.text.length) -
          this.text.indexOfPosition(existing.startPosition) +
          1
      );
    }
  }

  declineSuggestion(position: Position, id: AnnotationId) {
    const data = this.annotationList.getByPosition(position);

    const existing = Array.from(data?.values() || [])
      .flat()
      .find((s) => s.id === id && s.action === AnnotationAction.ADDITION);

    if (!existing) {
      throw new Error("No annotation with this id at this position found.");
    }

    this.annotationLog.add({
      type: AnnotationType.SUGGESTION,
      action: AnnotationAction.REMOVAL,
      description: AnnotationDescription.DECLINE_SUGGESTION,
      endClosed: existing.endClosed,
      userId: this.userId,
      dependentOn: existing.id,
      startPosition: existing.startPosition,
      endPosition: existing.endPosition,
    });

    if (existing.description === AnnotationDescription.INSERT_SUGGESTION) {
      this.text.delete(
        this.text.indexOfPosition(existing.startPosition),
        (existing.endPosition
          ? this.text.indexOfPosition(existing.endPosition, "right")
          : this.text.length) -
          this.text.indexOfPosition(existing.startPosition)
      );
    }
  }

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
      userId: this.userId,
      startPosition: this.text.getPosition(startIndex),
      endPosition: this.text.getPosition(endIndex),
      value: comment,
    });
  }

  removeComment(position: Position, id: AnnotationId) {
    const data = this.annotationList.getByPosition(position);

    const existing = Array.from(data?.values() || [])
      .flat()
      .find((s) => s.id === id);

    if (!existing) {
      throw new Error("No comment with this id at this position found.");
    }

    this.annotationLog.add({
      type: AnnotationType.COMMENT,
      action: AnnotationAction.REMOVAL,
      description: AnnotationDescription.REMOVE_COMMENT,
      endClosed: true,
      userId: this.userId,
      startPosition: existing.startPosition,
      endPosition: existing.endPosition,
      dependentOn: existing.id,
    });
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

/**
 * A summary of all changes that occurred at a single data point.
 */
interface AggregatedChange {
  position: Position;
  /** All annotations that were removed at this position. */
  removedAnnotations: AnnotationRemoveInfo[];
  /** The annotation that was added at this position, if any. */
  addedAnnotation: AnnotationAdditionInfo | null;
  /** The previous format state, for FormatChange events. */
  oldFormat: Annotation | undefined;
  /** The new format state, for FormatChange events. */
  newFormat: Annotation | undefined;
  /** An optional action to be performed on the text content itself. */
  textAction: TextAction | null;
}

/**
 * Describes an action to be performed on the text content, like deletion.
 */
interface TextAction {
  type: "delete";
  startPosition: Position;
  endPosition: Position | null;
}

/**
 * Internally used representation of a change
 * that removes a annotation
 */
interface AnnotationRemoveInfo {
  reason: AnnotationRemovalReason;
  prev: Annotation;
}

/**
 * Internally used representation of a change
 * that adds a annotation
 */
interface AnnotationAdditionInfo {
  replacement: AnnotationId | undefined;
  new: Annotation;
}
