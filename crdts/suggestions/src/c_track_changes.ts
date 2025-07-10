import {
  CObject,
  CollabEvent,
  CollabEventsRecord,
  CValueList,
  ICursorList,
  InitToken,
  LocalList,
  Position,
  TextEvent,
  UpdateMeta,
} from "@collabs/collabs";
import {
  CSuggestionLog,
  Suggestion,
  SuggestionAction,
  SuggestionDescription,
  SuggestionId,
  SuggestionType,
} from "./c_suggestion";

export interface TrackChangesTextInsertEvent extends TextEvent {
  suggestions: null | Suggestion[];
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
   * The old suggestion of the given range. Undefined for text that is written in editmode and not in an existing suggestion.
   */
  oldSuggestion: Suggestion | undefined;
  /**
   * The range's complete new suggestion. Undefined when the oldSuggestion just got removed.
   */
  newSuggestion: Suggestion | undefined;
}

export interface TrackChangesSuggestionAddedEvent extends CollabEvent {
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
  replacement: SuggestionId | undefined;
  /**
   * The new suggestion
   */
  suggestion: Suggestion;
}

/**
 * The possible reasons why a suggestion can be removed from a document
 */
export enum SuggestionRemovalReason {
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

export interface TrackChangesSuggestionRemovedEvent extends CollabEvent {
  /**
   * The id of the user who is responsible for removing the suggestion
   */
  author: string;
  /**
   * The reason why the suggestion was removed
   */
  reason: SuggestionRemovalReason;
  /**
   * The suggestion that got removed
   */
  suggestion: Suggestion;
}

export interface TrackChangesEventsRecord extends CollabEventsRecord {
  Insert: TrackChangesTextInsertEvent;
  Delete: TextEvent;
  FormatChange: TrackChangesFormatEvent;
  SuggestionAdded: TrackChangesSuggestionAddedEvent;
  SuggestionRemoved: TrackChangesSuggestionRemovedEvent;
}

/**
 * As stated in the peritext paper, whenever a format (here: suggestion) changes,
 * there is a datapoint at that position with all currently and onwards applied format data.
 * This is ordered by suggestion type (e.g. comments, suggestions). When applying a new
 * suggestion action, it must be calculated, which suggestions can be replaced:
 * e.g. if there is an "insertion suggestion" tag and an "accept suggestion" tag
 * is added, the "insertion suggestion" tag is no longer needed.
 *
 * The endingHere flag indicates whether this is the end of a formatting range.
 * If the formatting has the endClosed flag set to true, then the end is part of the range
 * (inclusive, i.e., also formatted). If the endClosed flag is set to false,
 * then the end is not part of the range and not formatted.
 */
type SuggestionDataPoint = Map<
  SuggestionType,
  (Suggestion & { endingHere: boolean })[]
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
   * The crdt that is responsible for syncing and storing the suggestion markers
   */
  private readonly suggestionLog: CSuggestionLog;

  /**
   * This is a not replicated, local view of the suggestionList mapped to their specific text positions.
   * This is described in the peritext paper.
   */
  private readonly suggestionList: LocalList<SuggestionDataPoint>;

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

    this.suggestionLog = super.registerCollab(
      "suggestionLog",
      (init) => new CSuggestionLog(init)
    );

    this.suggestionList = new LocalList(this.text.totalOrder);

    this.suggestionLog.on("Add", (e) =>
      this.addSuggestionLocally(e.suggestion, e.meta)
    );

    this.text.on("Insert", (e) => {
      this.emit("Insert", {
        index: e.index,
        values: e.values.join(""),
        positions: e.positions,
        suggestions: this.getSuggestionsInternal(e.positions[0]),
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
   * This is the "add" event handler of this.suggestionLog.
   * Whenever a new suggestion is created locally or by other clients, the
   * suggestionlog add event is triggered and must be handled by us to update our
   * local view of these suggestions.
   * Also emits suggestion events for changed ranges.
   * @param suggestion
   * @param meta
   */
  private addSuggestionLocally(suggestion: Suggestion, meta: UpdateMeta) {
    // ---- Step 1: Update local view and collect atomic change informations ----

    // Create data points at the start and end
    this.createDataPoint(suggestion.startPosition);
    if (suggestion.endPosition) this.createDataPoint(suggestion.endPosition);

    // All actual changes needed for the UI events
    // e.g. if a char is normal text(no suggestion) and is
    // inbetween a suggestion-decline range, there is no change
    // on this particular character and thus it should not be included in
    // an UI event
    const formatChanges: FormatChangeInfo[] = [];
    const suggestionAdditionChanges: SuggestionAdditionInfo[] = [];
    const suggestionRemovalChanges: SuggestionRemoveInfo[] = [];

    // The indices of the beginning and end of the range
    const startDataIndex = this.suggestionList.indexOfPosition(
      suggestion.startPosition
    );
    const endDataIndex =
      suggestion.endPosition === null
        ? this.suggestionList.length
        : this.suggestionList.indexOfPosition(suggestion.endPosition);

    // Go trough all datapoints in the given range and add the new suggestion.
    // If there are existing suggestions that are mutually exclusive with the
    // new suggestion (i.e. addition with a corresponding removal), remove
    // them, and discard the suggestion
    for (let i = startDataIndex; i <= endDataIndex; i++) {
      const position = this.suggestionList.getPosition(i);
      const data = this.suggestionList.getByPosition(position);

      if (!data) continue;

      // Get all suggestions that correspond to the new suggestion
      const correspondingSuggestions = data
        // Get all suggestions with the same type as the new suggestion (e.g. all comments or all suggestions)
        .get(suggestion.type)
        // Get all suggestions with the other action (e.g. addition -> removal)
        ?.filter((s) => suggestion.action !== s.action)
        // Get only suggestions that reference the new action or are referenced by it
        // (e.g. the acceptance of a suggestion only removes the suggestion that it references)
        ?.filter(
          (s) =>
            s.dependentOn === suggestion.id || suggestion.dependentOn === s.id
        );

      // If there are no corresponding suggestions, just insert the new suggestion
      if (!correspondingSuggestions || correspondingSuggestions.length === 0) {
        data.set(suggestion.type, [
          ...(data.get(suggestion.type) || []),
          {
            ...suggestion,
            endingHere: i === endDataIndex,
          },
        ]);

        // If it is not the ending of the range, or the range is inclusive, generate a
        // change, else the end is not formatted, and thus, nothing changes.
        if (suggestion.endClosed || i === endDataIndex) {
          const existingChanges = data
            .get(suggestion.type)
            ?.filter(
              (s) =>
                s.userId === suggestion.userId &&
                s.description === suggestion.description
            );
          const replacingExistingChange =
            existingChanges && existingChanges?.length > 0;

          suggestionAdditionChanges.push({
            replacement: replacingExistingChange
              ? existingChanges[existingChanges.length - 1].id
              : undefined, // This is not commutative, it should be the longest existing range. But that would be to expensive to calculate each time
            new: suggestion,
          });

          // Only generate a format change if there is no existing change with the
          // same description from the same user
          if (!replacingExistingChange) {
            formatChanges.push({
              previousValue: undefined,
              newSuggestion: suggestion,
              position: position,
            });
          } else {
            suggestionRemovalChanges.push({
              reason: SuggestionRemovalReason.REPLACED,
              prev: existingChanges[existingChanges.length - 1],
            });
          }
        }
      } else {
        // If there are corresponding suggestions, remove them if the new suggestion wins over them.
        // The new suggestion doesn't need to be added, tho, because it "was used" already to
        // discard these old suggestions.
        correspondingSuggestions
          ?.filter(
            (s) =>
              (suggestion.action === SuggestionAction.REMOVAL &&
                this.wins(suggestion, s)) ||
              (s.action === SuggestionAction.REMOVAL &&
                this.wins(s, suggestion))
          )
          ?.forEach((s) => {
            // Remove the suggestion from the local view
            data.set(
              suggestion.type,
              (data.get(suggestion.type) || []).filter((sug) => s !== sug)
            );

            // Getting the suggestion that is responsible for the
            // removal. Due to the commutative nature, this can be the
            // existing or the new suggestion
            const removalSuggestion =
              s.action === SuggestionAction.REMOVAL ? s : suggestion;

            suggestionRemovalChanges.push({
              reason:
                removalSuggestion.description ===
                SuggestionDescription.DECLINE_SUGGESTION
                  ? SuggestionRemovalReason.DECLINED
                  : SuggestionRemovalReason.ACCEPTED,
              prev: s,
            });

            // If the suggestion that gets removed was an addition, then generate a change.
            // If it is a removal, nothing changes, so no change is needed.
            if (
              s.action === SuggestionAction.ADDITION &&
              (suggestion.endClosed || i === endDataIndex)
            ) {
              formatChanges.push({
                position: position,
                previousValue: s,
                newSuggestion: undefined,
              });

              // When the removed suggestion was a deletion and the
              // new suggestion is a accept suggestion (or the other way around),
              // then delete the chars in the range
              // TODO: It feels a bit hacky, to do that here, is there maybe
              // a better way to apply actions to the text?
              if (
                (s.description === SuggestionDescription.DELETE_SUGGESTION &&
                  suggestion.description ===
                    SuggestionDescription.ACCEPT_SUGGESTION) ||
                (suggestion.description ===
                  SuggestionDescription.DELETE_SUGGESTION &&
                  s.description === SuggestionDescription.ACCEPT_SUGGESTION)
              ) {
                const acceptSuggestion =
                  s.description === SuggestionDescription.ACCEPT_SUGGESTION
                    ? s
                    : suggestion;

                const startIndex = this.text.indexOfPosition(
                  acceptSuggestion.startPosition
                );
                const endIndex = acceptSuggestion.endPosition
                  ? this.text.indexOfPosition(acceptSuggestion.endPosition)
                  : this.text.length;

                this.text.delete(startIndex, endIndex - startIndex);
              }
            }
          });
      }
    }

    // ---- Step 2: Generate events from the collected changes ----
    this.emitFormatEvents(formatChanges, suggestion, meta);
    this.emitSuggestionRemoveEvents(suggestionRemovalChanges, suggestion, meta);
    this.emitSuggestionAdditionEvents(suggestionAdditionChanges, meta);
  }

  /**
   * Processes a sequence of change entries and emits UI-friendly events.
   *
   * - Filters out duplicates
   * @param changes
   * @param meta
   */
  private emitSuggestionAdditionEvents(
    changes: SuggestionAdditionInfo[],
    meta: UpdateMeta
  ) {
    const map = new Map();
    for (const item of changes) {
      map.set(item.new.id, item);
    }
    const changesWithoutDuplicates: SuggestionAdditionInfo[] = Array.from(
      map.values()
    );

    for (const change of changesWithoutDuplicates) {
      const startIndex = this.text.indexOfPosition(change.new.startPosition);
      const endIndex = change.new.endPosition
        ? this.text.indexOfPosition(change.new.endPosition)
        : this.text.length - 1;
      this.emit("SuggestionAdded", {
        meta: meta,
        startIndex: startIndex,
        endIndex: endIndex,
        replacement: change.replacement,
        suggestion: change.new,
      });
    }
  }

  /**
   * Processes a sequence of change entries and emits UI-friendly events.
   *
   * - Filters out duplicates
   * @param changes
   * @param suggestion
   * @param meta
   */
  private emitSuggestionRemoveEvents(
    changes: SuggestionRemoveInfo[],
    suggestion: Suggestion,
    meta: UpdateMeta
  ) {
    const map = new Map();
    for (const item of changes) {
      map.set(item.prev.id, item);
    }
    const changesWithoutDuplicates: SuggestionRemoveInfo[] = Array.from(
      map.values()
    );

    for (const change of changesWithoutDuplicates) {
      this.emit("SuggestionRemoved", {
        meta: meta,
        reason: change.reason,
        suggestion: change.prev,
        author: suggestion.userId,
      });
    }
  }

  /**
   * Processes a sequence of change entries and emits UI-friendly format events.
   *
   * - Converts document positions to character indices once per change.
   * - Merges consecutive changes sharing the same Lamport timestamp, sender ID,
   *   and contiguous indices into a single event.
   * - Emits a TrackChangesSuggestionsEvent for each combined change range.
   *
   * @param changes   Array of ChangeInfo objects describing individual edits.
   * @param suggestion  The Suggestion object representing the new suggestion state.
   * @param meta      Metadata about the update.
   */
  private emitFormatEvents(
    changes: FormatChangeInfo[],
    suggestion: Suggestion,
    meta: UpdateMeta
  ) {
    if (!changes.length) return;

    // Precompute indices to avoid repeated position lookups
    type ChangeWithIndex = { info: FormatChangeInfo; index: number };
    const enriched: ChangeWithIndex[] = changes.map((c) => ({
      info: c,
      index: this.text.indexOfPosition(c.position),
    }));

    // Helper to compare two suggestions by Lamport and senderID
    const isSameSuggestion = (a?: Suggestion, b?: Suggestion) => {
      if ((!a && b) || (!b && a)) return false;
      return (!a && !b) || a?.id === b?.id;
    };

    // Group consecutive enriched entries with identical suggestion identity and contiguous indices
    const groups: ChangeWithIndex[][] = [];
    let currentGroup: ChangeWithIndex[] = [enriched[0]];

    for (let i = 1; i < enriched.length; i++) {
      const prev = enriched[i - 1];
      const curr = enriched[i];
      const sameSuggestion =
        isSameSuggestion(prev.info.previousValue, curr.info.previousValue) &&
        isSameSuggestion(prev.info.newSuggestion, curr.info.newSuggestion);
      const contiguous = curr.index === prev.index + 1;

      if (sameSuggestion && contiguous) {
        currentGroup.push(curr);
      } else {
        groups.push(currentGroup);
        currentGroup = [curr];
      }
    }
    groups.push(currentGroup);

    // Emit an event per group
    for (const group of groups) {
      const first = group[0];
      const last = group[group.length - 1];

      const startIndex = first.index;
      const endIndex = last.index;
      const author = suggestion.userId;

      const event: TrackChangesFormatEvent = {
        startIndex,
        endIndex,
        author,
        oldSuggestion: first.info.previousValue,
        newSuggestion: first.info.newSuggestion,
        meta,
      };

      this.emit("FormatChange", event);
    }
  }

  /**
   * Returns the currently applied suggestions at a given text position.
   * Open endings are not formatted and thus not included in the returned data.
   *
   * If position is not currently present, returns the formatting that a character
   * at the position would have if present...
   * @param position
   */
  private getSuggestionsInternal(position: Position): Suggestion[] | null {
    const dataIndex = this.suggestionList.indexOfPosition(position, "left");
    if (dataIndex === -1) {
      return null;
    }

    const dataPos = this.suggestionList.getPosition(dataIndex);
    const data = this.suggestionList.getByPosition(dataPos);
    if (!data) return null;
    // Flatten all suggestion arrays and filter out those with endingHere = true where the ending is not inclusive
    const suggestions = Array.from(data.values())
      .flat()
      .filter((s) => !s.endingHere || s.endClosed)
      // oxlint-disable-next-line no-unused-vars
      .map(({ endingHere, ...rest }) => rest as Suggestion);
    return suggestions.length > 0 ? suggestions : null;
  }

  /**
   * As stated in the peritext paper, whenever a format (here: suggestion) changes,
   * there is a datapoint at that position with all currently and onwards applied format data.
   *
   * This function creates such a data point if it doesn't already exists, inferring the
   * still applied data from the previous data point.
   * @param position The position where to create a data point
   */
  private createDataPoint(position: Position): void {
    if (this.suggestionList.hasPosition(position)) return;

    // Gets the next available index of a datapoint to the left. Returns -1 if none is found
    const prevIndex = this.suggestionList.indexOfPosition(position, "left");
    if (prevIndex === -1) {
      this.suggestionList.set(position, new Map());
    } else {
      const prev = this.suggestionList.get(prevIndex);

      this.suggestionList.set(position, new Map(prev));
    }
  }

  /**
   * copied from https://github.com/composablesys/collabs/blob/1063c40e98034c0c4767aa79e1d3955424ba1c47/crdts/src/list/c_rich_text.ts#L444
   *
   * Returns whether suggestionA wins over suggestionB, either in the Lamport
   * order (with senderID tiebreaker) or because
   * suggestionB is undefined.
   *
   * If suggestionA and suggestionB come from the same transaction, this also
   * returns true. That is okay because we always call wins() in transaction order,
   * and later suggestions in the same transaction win over
   * earlier suggestions.
   */
  private wins(
    suggestionA: Suggestion,
    suggestionB: Suggestion | undefined
  ): boolean {
    if (suggestionB === undefined) return true;
    if (suggestionA.lamport > suggestionB.lamport) return true;
    if (suggestionA.lamport === suggestionB.lamport) {
      // In === case, the two suggestions come from the same transaction,
      // but suggestionA is newer (a later message in the same transaction).
      if (suggestionA.senderID >= suggestionB.senderID) return true;
    }
    return false;
  }

  insert(index: number, values: string, isSuggestion: boolean): void {
    if (values.length === 0) return;
    this.text.insert(index, ...values);

    const startPos = this.text.getPosition(index);
    const existing = this.getSuggestionsInternal(startPos);

    // If the insertion is a suggestion and not part of an existing insertion
    // suggestion of the same user, create a new suggestion
    if (
      isSuggestion &&
      !(
        existing &&
        existing.filter(
          (s) =>
            s.description === SuggestionDescription.INSERT_SUGGESTION &&
            s.userId === this.userId
        ).length > 0
      )
    ) {
      // This is the char after the insertion, so that we can model a growing range (i.e. open end)
      const endPos =
        index + values.length === this.text.length
          ? null
          : this.text.getPosition(index + values.length);

      this.suggestionLog.add({
        type: SuggestionType.SUGGESTION,
        action: SuggestionAction.ADDITION,
        description: SuggestionDescription.INSERT_SUGGESTION,
        startPosition: startPos,
        endPosition: endPos,
        endClosed: false,
        userId: this.userId,
      });
    }
  }

  delete(index: number, count: number, isSuggestion: boolean) {
    // Case 1: Not a suggestion, just delete the text and exit.
    if (!isSuggestion) {
      this.text.delete(index, count);
      return;
    }

    // Case 2: The deletion occurs entirely within a single insertion suggestion
    // from the same user. In this case, the text is deleted directly.
    if (this.isRangeWithinSameInsertion(index, count, this.userId)) {
      this.text.delete(index, count);
      return;
    }

    // Case 3: Create a new delete suggestion
    const startPos = this.text.getPosition(index);
    this.createDeleteSuggestion(index, count, startPos);
  }

  /**
   * Checks if a range (from index to index + count) is fully contained
   * within a single INSERT_SUGGESTION from a single user.
   * "Same suggestion" is identified by matching lamport and senderId.
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

    // Get all relevant user insertion suggestions at the start of the deletion.
    const insertionsAtStart = (
      this.getSuggestionsInternal(startPos) || []
    ).filter(
      (s) =>
        s.description === SuggestionDescription.INSERT_SUGGESTION &&
        s.userId === userId
    );

    // If there are no user insertions at the start, we can stop early.
    if (insertionsAtStart.length === 0) {
      return false;
    }

    // For efficiency, create a lookup Set of unique identifiers for the suggestions
    // found at the start
    const startSuggestionIds = new Set(insertionsAtStart.map((s) => s.id));

    // Get all relevant user insertion suggestions at the end of the deletion.
    const insertionsAtEnd = (this.getSuggestionsInternal(endPos) || []).filter(
      (s) =>
        s.description === SuggestionDescription.INSERT_SUGGESTION &&
        s.userId === userId
    );

    // Check if any suggestion at the end position also exists in our start set.
    // This confirms the deletion range is bounded by the same suggestion.
    return insertionsAtEnd.some((endSuggestion) =>
      startSuggestionIds.has(endSuggestion.id)
    );
  }

  /**
   * Creates a new delete suggestion. If adjacent delete suggestions
   * from the same user are present, the suggestion grows by their size
   * (i.e. "they get merged")
   */
  private createDeleteSuggestion(
    index: number,
    count: number,
    startPos: Position
  ) {
    // Find the "outermost" previous and next delete suggestions.
    const prevSuggestion = this.findAdjacentDeleteSuggestion(
      index > 0 ? this.text.getPosition(index - 1) : null,
      "previous"
    );
    const nextSuggestion = this.findAdjacentDeleteSuggestion(
      this.text.getPosition(index + 1),
      "next"
    );

    // Determine the final start and end positions for the new/merged suggestion.
    const finalStartPosition = prevSuggestion
      ? prevSuggestion.startPosition
      : startPos;

    const endOfDeletionIndex = index + count - 1;
    let finalEndPosition = this.text.getPosition(endOfDeletionIndex);

    if (nextSuggestion?.endPosition) {
      const nextSuggestionEndIndex = this.text.indexOfPosition(
        nextSuggestion.endPosition
      );
      // If the adjacent suggestion extends further than the current deletion,
      // adopt its endpoint to merge them.
      if (nextSuggestionEndIndex > endOfDeletionIndex) {
        finalEndPosition = nextSuggestion.endPosition;
      }
    }

    // Create the suggestion with the determined positions.
    // This call is now identical for all cases.
    this.suggestionLog.add({
      type: SuggestionType.SUGGESTION,
      action: SuggestionAction.ADDITION,
      description: SuggestionDescription.DELETE_SUGGESTION,
      startPosition: finalStartPosition,
      endPosition: finalEndPosition,
      endClosed: true,
      userId: this.userId,
    });
  }

  /**
   * Finds the most relevant adjacent delete suggestion at a given position.
   * The most relevant are the biggest delete suggestions of the same user
   * @param position The position at which to search. If null, nothing will be found.
   * @param direction 'previous' looks for the suggestion with the earliest start, 'next' for the one with the latest end.
   * @returns The found suggestion or undefined.
   */
  private findAdjacentDeleteSuggestion(
    position: Position | null,
    direction: "previous" | "next"
  ): Suggestion | undefined {
    if (!position) {
      return undefined;
    }

    const candidates = (this.getSuggestionsInternal(position) || []).filter(
      (s) =>
        s.description === SuggestionDescription.DELETE_SUGGESTION &&
        s.userId === this.userId
    );

    if (candidates.length === 0) {
      return undefined;
    }

    // Instead of sorting the entire array, we find the best element directly.
    // This is more efficient when you only need to find an extremum.
    return candidates.reduce((best, current) => {
      if (direction === "previous") {
        // Find the suggestion that starts the earliest.
        const bestIndex = this.text.indexOfPosition(best.startPosition);
        const currentIndex = this.text.indexOfPosition(current.startPosition);
        return currentIndex < bestIndex ? current : best;
      } else {
        // direction === 'next'
        // Find the suggestion that ends the latest.
        const bestEndIndex = best.endPosition
          ? this.text.indexOfPosition(best.endPosition)
          : -1;
        const currentEndIndex = current.endPosition
          ? this.text.indexOfPosition(current.endPosition)
          : -1;
        return currentEndIndex > bestEndIndex ? current : best;
      }
    });
  }

  acceptSuggestion() {}
}

/**
 * A summary of all changes that occurred at a single data point.
 */
interface AggregatedChange {
  position: Position;
  /** All suggestions that were removed at this position. */
  removedSuggestions: SuggestionRemoveInfo[];
  /** The suggestion that was added at this position, if any. */
  addedSuggestion: SuggestionAdditionInfo | null;
  /** The previous format state, for FormatChange events. */
  oldFormat: Suggestion | undefined;
  /** The new format state, for FormatChange events. */
  newFormat: Suggestion | undefined;
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
 * that influences the formatting of a text range
 */
interface FormatChangeInfo {
  position: Position;
  previousValue: Suggestion | undefined;
  newSuggestion: Suggestion | undefined;
}

/**
 * Internally used representation of a change
 * that removes a suggestion
 */
interface SuggestionRemoveInfo {
  reason: SuggestionRemovalReason;
  prev: Suggestion;
}

/**
 * Internally used representation of a change
 * that adds a suggestion
 */
interface SuggestionAdditionInfo {
  replacement: SuggestionId | undefined;
  new: Suggestion;
}
