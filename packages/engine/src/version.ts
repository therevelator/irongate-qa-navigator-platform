/**
 * The engine's version. Recorded with every value the QE Navigator Collector sends (and shown in "How this was
 * calculated"), so a value can always be traced to the rules that produced it. Bump it whenever a calculation,
 * a parser or an evidence list changes its output: minor for a new metric or evidence field, patch for a fix,
 * major for a changed rule.
 */
export const ENGINE_VERSION = '1.0.0';
