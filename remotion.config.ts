// Used by `npm run studio` (the programmatic renderer in src/pipeline/render.ts
// passes the same options directly).
import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
