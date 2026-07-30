export * from "./span-processor.js";
export * from "./span-filter.js";
// Public Sea Traces alias for LangfuseSpanProcessor.
export {
  LangfuseSpanProcessor as SeaTracesSpanProcessor,
  type LangfuseSpanProcessorParams as SeaTracesSpanProcessorParams,
} from "./span-processor.js";
