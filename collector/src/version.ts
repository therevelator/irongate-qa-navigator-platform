/** The Collector's version: sent as the User-Agent (qe-collector/<version>) and shown in the QE Navigator ingestion log. */
export const VERSION = '0.2.0';
export const USER_AGENT = `qe-collector/${VERSION} (node ${process.versions.node}; ${process.platform})`;
