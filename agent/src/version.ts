/** The agent's version: sent as the User-Agent (qe-agent/<version>) and shown in the QE Navigator ingestion log. */
export const VERSION = '0.1.0';
export const USER_AGENT = `qe-agent/${VERSION} (node ${process.versions.node}; ${process.platform})`;
