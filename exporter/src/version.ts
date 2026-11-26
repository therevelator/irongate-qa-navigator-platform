/** The Exporter's version: sent as the User-Agent (qe-exporter/<version>) and shown in the QE Navigator ingestion log. */
export const VERSION = '0.6.0';
export const USER_AGENT = `qe-exporter/${VERSION} (node ${process.versions.node}; ${process.platform})`;
