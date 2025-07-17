/**
 * A suggestion log to store suggestions and comments. Used by CTrackChanges.
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

/**
 * A string that combines the Lamport timestamp and the `senderID` into a unique identifier,
 * using the format `lamport-senderId`.
 */
export type SuggestionId = string;

/**
 * Type of a suggestion.
 */
export enum SuggestionType {
  /** A suggestion that adds a textual comment to a range of text. */
  COMMENT = "comment",
  /** A suggestion that proposes an insertion or deletion of text within a given range. */
  SUGGESTION = "suggestion",
}

/**
 * Specifies whether the suggestion represents an addition or a removal of a mark.
 *
 * An addition introduces a new mark, for example, adding a comment (`ADD_COMMENT`)
 * or proposing a deletion (`DELETE_SUGGESTION`).
 *
 * A removal resolves an existing mark, for example, removing a comment (`REMOVE_COMMENT`)
 * or accepting a suggestion (`ACCEPT_SUGGESTION`).
 */
export enum SuggestionAction {
  ADDITION = "addition",
  REMOVAL = "removal",
}

/**
 * The more detailed description of what the suggestion does.
 */
export enum SuggestionDescription {
  /** Adds a text comment to the given range */
  ADD_COMMENT = "addComment",
  /** Removes a text comment from the given range */
  REMOVE_COMMENT = "removeComment",
  /** Marks the given range as a suggestion to insert text into the final document. */
  INSERT_SUGGESTION = "insertSuggestion",
  /** Marks the given range as a suggestion to delete text from the final document. */
  DELETE_SUGGESTION = "deleteSuggestion",
  /** Marks the text in the given range as an accepted suggestion, e.g., the text becomes part of the main document. */
  ACCEPT_SUGGESTION = "acceptSuggestion",
  /** Marks the text in the given range as a declined suggestion, e.g., the proposed change is discarded. */
  DECLINE_SUGGESTION = "declineSuggestion",
}

export interface PartialSuggestion {
  /** The type of the suggestion, specifying whether it concerns a comment or a textual change. */
  readonly type: SuggestionType;
  /** The action of the suggestion, i.e. if it inserts or removes a suggestion or comment */
  readonly action: SuggestionAction;
  /** The specific description of the suggestion's purpose. */
  readonly description: SuggestionDescription;
  /** The value of the suggestion. For comments, this holds the comment text. For other types, it is typically `undefined`. */
  readonly value?: string | undefined;
  /** The id of the user account that created the suggestion */
  readonly userId: string;
  /** The start of the text range this suggestion applies to. */
  readonly startPosition: Position;
  /** The end of the text range this suggestion applies to, or `null` for the end of the document. */
  readonly endPosition: Position | null;
  /** Determines the behavior of insertions at the `endPosition`. If `true`, an insertion at the end position is considered part of the suggestion's range. */
  readonly endClosed: boolean;
  /**
   * When the suggestion is dependent on another suggestion, then this is the id of the other suggestion.
   * e.g. suggestions of with the action "removal" are dependend of the corresponding "addition" suggestion.
   */
  readonly dependentOn?: SuggestionId;
}

/**
 * A suggestion is the building block of the track changes feature.
 * Each proposed change is modeled as a suggestion that spans a range of text.
 * This can be an insertion of text, a comment, or the acceptance or decline of such a suggestion.
 *
 * Each suggestion is described by its type, its action, and a distinct description.
 */
export interface Suggestion extends PartialSuggestion {
  /** A unique identifier, combining the Lamport timestamp and the senderID into a single string in the format `lamport-senderId` for easier handling. */
  readonly id: SuggestionId;
  /** The lamport timestamp of the action that inserted the suggestion to determine a happened-before relationship */
  readonly lamport: number;
  /** The id of the sender that inserted the suggestion. Used for lamport-tie-breaking */
  readonly senderID: string;
}

interface SuggestionLogSavedState {
  /** The ids of all senders (e.g. clients) that sent suggestions */
  senderIds: string[];
  /** The number of suggestions from each sender, corresponding to the `senderIds` array. Used to reconstruct the map. */
  lengths: number[];
  /** A flattened list of all suggestions. */
  suggestions: PartialSuggestion[];
  /** A flattened list of Lamport timestamps for each suggestion. */
  lamports: number[];
}

/**
 * This event is emitted whenever a suggestion is added to the log.
 * This can be triggered by a local operation or by a message from a remote replica.
 */
export interface SuggestionAddEvent extends CollabEvent {
  suggestion: Suggestion;
}

export interface SuggestionEventsRecord extends CollabEventsRecord {
  Add: SuggestionAddEvent;
}

/**
 * An append-only log of suggestions and comments.
 * Intended for internal use by `CTrackChanges`.
 */
export class CSuggestionLog extends PrimitiveCRDT<SuggestionEventsRecord> {
  /**
   * A log of all received suggestions, grouped by `senderID`.
   * This is the primary state of the CRDT and is used for saving its state.
   */
  private readonly log = new Map<string, Suggestion[]>();

  private readonly partialSuggestionSerializer: Serializer<PartialSuggestion> =
    DefaultSerializer.getInstance<PartialSuggestion>();
  private readonly savedStateSerializer: Serializer<SuggestionLogSavedState> =
    DefaultSerializer.getInstance<SuggestionLogSavedState>();

  constructor(init: InitToken) {
    super(init);
  }

  /**
   * Adds a new suggestion to the log.
   * This operation is broadcast to all replicas.
   * @param suggestion The suggestion to add.
   */
  add(suggestion: PartialSuggestion) {
    super.sendCRDT(this.partialSuggestionSerializer.serialize(suggestion));
  }

  protected override receiveCRDT(
    message: Uint8Array | string,
    meta: MessageMeta,
    crdtMeta: CRDTMessageMeta
  ): void {
    const decoded = this.partialSuggestionSerializer.deserialize(
      message as Uint8Array
    );

    const suggestion: Suggestion = {
      ...decoded,
      id: `${getOrThrow(crdtMeta.lamportTimestamp)}-${crdtMeta.senderID}`,
      lamport: getOrThrow(crdtMeta.lamportTimestamp),
      senderID: crdtMeta.senderID,
    };

    this.log.set(crdtMeta.senderID, [
      ...(this.log.get(crdtMeta.senderID) || []),
      suggestion,
    ]);

    this.emit("Add", { suggestion, meta });
  }

  protected override saveCRDT(): Uint8Array {
    const senderIDs = Array.from({ length: this.log.size });
    const lengths = Array.from({ length: this.log.size });
    const suggestions: Suggestion[] = [];
    const lamports: number[] = [];

    let i = 0;
    for (const [senderID, senderSuggestions] of this.log) {
      senderIDs[i] = senderID;
      lengths[i] = senderSuggestions.length;
      for (const suggestion of senderSuggestions) {
        suggestions.push(suggestion);
        lamports.push(suggestion.lamport);
      }
      i++;
    }

    return this.savedStateSerializer.serialize({
      senderIds: senderIDs,
      lengths,
      suggestions,
      lamports,
    } as SuggestionLogSavedState);
  }

  protected override loadCRDT(
    savedState: Uint8Array | null,
    meta: SavedStateMeta,
    _: CRDTSavedStateMeta
  ): void {
    if (savedState === null) return;

    const decoded = this.savedStateSerializer.deserialize(savedState);
    let suggestionIndex = 0;
    for (let i = 0; i < decoded.senderIds.length; i++) {
      const senderID = decoded.senderIds[i];
      let lastLamport: number;
      let bySender = this.log.get(senderID);
      if (bySender === undefined) {
        bySender = [];
        this.log.set(senderID, bySender);
        lastLamport = -1;
      } else {
        lastLamport = bySender[bySender.length - 1].lamport;
      }

      for (let j = 0; j < decoded.lengths[i]; j++) {
        const lamport = decoded.lamports[suggestionIndex];
        if (lamport > lastLamport) {
          const suggestion: Suggestion = {
            ...decoded.suggestions[suggestionIndex],
            lamport,
            senderID,
            id: `${lamport}-${senderID}`,
          };
          bySender.push(suggestion);

          this.emit("Add", { suggestion, meta });
        }
        suggestionIndex++;
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
