/**
 * A "latest one wins" counter, for discarding the results of work that has been overtaken.
 *
 * This codebase has cycled through three spellings of this idea in as many months: an `alive`
 * boolean per effect, request-id counters bolted onto store setters, and a module-scope integer
 * per action. They all do the same thing, so it is written once here and shared.
 *
 * Independent of React and of the stores, so it works for a module-level sequence shared by
 * every caller of an action and for a per-component one held in a ref.
 */
export function createSequence() {
  let latest = 0;
  return {
    next: () => ++latest,
    isCurrent: (ticket) => ticket === latest,
  };
}
