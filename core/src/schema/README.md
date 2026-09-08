# Schema

TypeScript type definitions for the postrun v1.1 event schema. Translates postrun-schema-v1.1.md into strict interfaces for Session, SessionSegment, Actor, Step, Turn, CaptureCoverage, Flag, and Verdict.

Built-in discriminated union on Step.type (CommandPayload | EditPayload | ReadPayload | MessagePayload | OtherPayload).
