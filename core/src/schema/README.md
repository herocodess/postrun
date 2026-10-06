# Schema

TypeScript type definitions and a runtime validator (`validate.ts`) for the postrun v1.2 event schema (`docs/postrun-schema-v1.2.md`). Strict interfaces for Session, SessionSegment, Actor, Step, Turn, CaptureCoverage, Flag, and Verdict.

Built-in discriminated union on Step.type (CommandPayload | EditPayload | ReadPayload | MessagePayload | OtherPayload).
