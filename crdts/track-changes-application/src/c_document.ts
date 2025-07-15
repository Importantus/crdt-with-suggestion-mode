import { CObject, CText, InitToken } from "@collabs/collabs";
import { TrackChanges } from "../../track-changes-crdt/build/esm";

/**
 * Unique identifier type for collaborative documents.
 * Used to reference and manage documents in the application.
 */
export type DocumentID = string;

/**
 * Represents a single collaborative document with track changes support.
 * Contains metadata (file name) and the document content.
 */
export class TrackChangesDocument extends CObject {
  /** Unique identifier for this document instance. */
  readonly id: DocumentID;
  /** Collaborative text field for the document's file name. */
  readonly fileName: CText;
  /** Collaborative content with track changes functionality. */
  readonly content: TrackChanges;

  /**
   * Constructs a new TrackChangesDocument.
   * @param init Initialization token from Collabs framework.
   * @param id Unique document identifier.
   * @param userId The user ID for attribution in track changes.
   */
  constructor(init: InitToken, id: DocumentID, userId: string) {
    super(init);
    this.id = id;

    this.fileName = super.registerCollab(
      id + "fileName",
      (init) => new CText(init)
    );

    this.content = super.registerCollab(
      id + "content",
      (init) =>
        new TrackChanges(init, {
          userId,
        })
    );
  }
}
