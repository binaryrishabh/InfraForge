import type { LearningLesson } from "@infraforge/contracts/learning";

export const lesson: LearningLesson = {
  id: "database-read-and-write", contentVersion: 1, trackId: "foundations", moduleId: "compute-and-data",
  title: "A database read and a write", summary: "Reading retrieves stored data; writing asks to change it.",
  kind: "conceptual-exercise", level: "beginner", availability: "available", prerequisites: ["virtual-machines"], experiment: null,
  problem: ["Opening a saved note and saving an edit both use the notes service. Why might they ask the database to do different work?"],
  explanation: [
    "A read asks the database to retrieve data, such as the text for a note's identifier. A write asks it to change stored data, such as replacing that text. The application chooses which operations to request based on what the user is trying to do.",
    "A write may involve checks and coordination before it is acknowledged. Reads also cost work: finding and returning data is not free. You cannot infer either operation's duration just from the words read and write; the query, data and database configuration matter.",
    "If a client stops waiting for a save response, the write's outcome may be uncertain to that client. The database might have accepted the change before the response was lost. A missing response alone does not establish whether the data changed.",
  ],
  check: { question: "Which operation asks to change stored data?",
    choices: [{ id: "save", text: "Save a replacement body for an existing note." }, { id: "open", text: "Fetch the existing body without changing it." }],
    correctChoiceId: "save", explanation: "Saving the replacement is a write. Fetching the existing body is a read." },
  limitations: ["No database operations run here. Transactions, replication, storage durability and query performance need separate treatment."],
};
