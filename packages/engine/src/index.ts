/**
 * QE Navigator calculation engine: the parsers and metric calculations of the QE Navigator server (its internal
 * calculation code; nothing outside the server runs it). Pure TypeScript: inputs in, metric values
 * and evidence out. No database, no HTTP, no environment variables, no file system; the only imports are Node's
 * built-in crypto (stable hashes of test names and findings) and zlib (reading zip archives).
 */
export { ENGINE_VERSION } from './version';

export * from './calc/types';
export * from './calc/metrics';
export * from './calc/ci';
export * from './calc/delivery';
export * from './calc/work';
export * from './calc/quality';
export * from './calc/evidence';
export * from './store/records';

export * as xml from './parsers/xml';
export * as zip from './parsers/zip';
export * as tests from './parsers/testReports';
export * as coverage from './parsers/coverageReports';
export * as sarif from './parsers/sarif';
export * as pipelines from './parsers/pipelineEvents';
export * as delivery from './parsers/deliveryEvents';
export * as issues from './parsers/issueEvents';
