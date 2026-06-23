export * from "./span-processor.js";
export * from "./span-filter.js";
// Sea Traces 对外别名，与内部 LangfuseSpanProcessor 等价
export {
  LangfuseSpanProcessor as SeaTracesSpanProcessor,
  type LangfuseSpanProcessorParams as SeaTracesSpanProcessorParams,
} from "./span-processor.js";
