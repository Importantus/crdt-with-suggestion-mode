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
 * The lamport timestamp and the senderId combined in one string of the format lamport-senderId
 */
export type SuggestionId = string;

/**
 * Type of a suggestion.
 */
export enum SuggestionType {
  /** A string that is added to a range of text */
  COMMENT = "comment",
  /** A proposed insertion or deletion into or of a range of text */
  SUGGESTION = "suggestion",
}

/**
 * Specificies whether the suggestion adds or removes something.
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
  /** Marks the given range as a suggestion to insert the text into the final document */
  INSERT_SUGGESTION = "insertSuggestion",
  /** Marks the given range as a suggestion to delete the text from the final document */
  DELETE_SUGGESTION = "deleteSuggestion",
  /** Marks the text in the given range as an approved suggestion e.g. normal text */
  ACCEPT_SUGGESTION = "acceptSuggestion",
  /** Marks the text in the given range as declined suggestion e.g. removed text */
  DECLINE_SUGGESTION = "declineSuggestion",
}

export interface PartialSuggestion {
  /** The type of the mark. Specifies broadly if something is added or removed. */
  readonly type: SuggestionType;
  /** The action of the suggestion. */
  readonly action: SuggestionAction;
  /** The specific description of the mark */
  readonly description: SuggestionDescription;
  /** The value. Only needed for comments. Stores the text of comments */
  readonly value?: string | undefined;
  /** The id of the user account that created the suggestion */
  readonly userId: string;
  /** Start of the range */
  readonly startPosition: Position;
  /** End of the range. Null for end of the document */
  readonly endPosition: Position | null;
  /** Whether inserting directly behind the range extends the range to include the insertion or not */
  readonly endClosed: boolean;
  /**
   * When the suggestion is dependent on another suggestion, then this is the id of the other suggestion.
   * e.g. suggestions of with the action "removal" are dependend of the corresponding "addition" suggestion.
   */
  readonly dependentOn?: SuggestionId;
}

export interface Suggestion extends PartialSuggestion {
  /** For easier handling, this is the lamport timestamp and the senderId combined in one string of the format lamport-senderId */
  readonly id: SuggestionId;
  /** The lamport timestamp of the action that inserted the suggestion to determine a happened-before relationship */
  readonly lamport: number;
  /** The id of the sender that inserted the suggestion. Used for lamport-tie-breaking */
  readonly senderID: string;
}

interface SuggestionLogSavedState {
  /** The ids of all senders (e.g. clients) that sent suggestions */
  senderIds: string[];
  /** The number of suggestions of each sender. Used to recreate a map from the array of suggestions */
  lengths: number[];
  /** The suggestions */
  suggestions: PartialSuggestion[];
  /** The lamport timestamp for each suggestion */
  lamports: number[];
}

/**
 * This event is emitted erverytime a suggestion is added to the log.
 * This can happen locally or by another client.
 */
export interface SuggestionAddEvent extends CollabEvent {
  suggestion: Suggestion;
}

export interface SuggestionEventsRecord extends CollabEventsRecord {
  Add: SuggestionAddEvent;
}

/**
 * An append only log of suggestions and comments, used by CTrackChanges.
 * Only used internally and not exported.
 */
export class CSuggestionLog extends PrimitiveCRDT<SuggestionEventsRecord> {
  /**
   * A log of suggestions. They are needed to save the current state of the crdt.
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
   * Adds a suggestion and sends it to all other connected client and to itself.
   * @param suggestion The suggestion to add
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
    return this.savedStateSerializer.serialize(
      Array.from(this.log.entries()).reduce(
        (acc, [senderID, senderSuggestions]) => {
          acc.senderIds.push(senderID);
          acc.lengths.push(senderSuggestions.length);

          senderSuggestions.forEach((suggestion) => {
            acc.suggestions.push(suggestion);
            acc.lamports.push(suggestion.lamport);
          });

          return acc;
        },
        {
          senderIds: [],
          lengths: [],
          suggestions: [],
          lamports: [],
        } as SuggestionLogSavedState
      )
    );
  }

  protected override loadCRDT(
    savedState: Uint8Array | null,
    meta: SavedStateMeta,
    _: CRDTSavedStateMeta
  ): void {
    if (!savedState) return;

    const decoded = this.savedStateSerializer.deserialize(savedState);

    for (let i = 0; i < decoded.senderIds.length; i++) {
      const senderId = decoded.senderIds[i];
      const numberOfSuggestions = decoded.lengths[i];

      const lamportTimestamps = decoded.lamports.splice(0, numberOfSuggestions);
      const suggestions = decoded.suggestions.splice(0, numberOfSuggestions);

      const currentSuggestionsBySender = this.log.get(senderId) || [];

      // Used to determine if we already have a suggestion
      const lastLamportTimestamp =
        currentSuggestionsBySender[currentSuggestionsBySender.length - 1]
          .lamport || -1;

      for (let j = 0; j < numberOfSuggestions; j++) {
        const partialSuggestion = suggestions[j];
        const lamport = lamportTimestamps[j];

        if (lamport > lastLamportTimestamp) {
          const suggestion: Suggestion = {
            ...partialSuggestion,
            id: `${lamport}-${senderId}`,
            lamport,
            senderID: senderId,
          };

          this.log.set(senderId, [...currentSuggestionsBySender, suggestion]);

          this.emit("Add", { suggestion, meta });
        }
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
