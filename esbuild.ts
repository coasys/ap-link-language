import * as esbuild from "https://deno.land/x/esbuild@v0.17.18/mod.js";
import { denoPlugins } from "https://deno.land/x/esbuild_deno_loader@0.7.0/mod.ts";

// Resolve `@coasys/ad4m-ldk` to its compiled lib in the workspace.
// Same pattern as centralized-p-diff-sync.
const ad4mLdkEntry = new URL(
  "../../ad4m/ad4m-ldk/js/lib/index.js",
  import.meta.url,
).pathname;

const ad4mLdkAliasPlugin = {
  name: "ad4m-ldk-alias",
  setup(build: any) {
    // Mark ad4m:host as external — resolved at runtime by the executor
    build.onResolve({ filter: /^ad4m:host$/ }, () => ({
      path: "ad4m:host",
      external: true,
    }));
    // Resolve @coasys/ad4m-ldk to the local workspace build
    build.onResolve({ filter: /^@coasys\/ad4m-ldk$/ }, () => ({
      path: ad4mLdkEntry,
      namespace: "file",
    }));
  },
};

const result = await esbuild.build({
  plugins: [
    ad4mLdkAliasPlugin,
    ...denoPlugins(),
  ],
  entryPoints: ["index.ts"],
  outfile: "build/bundle.js",
  bundle: true,
  platform: "node",
  target: "deno1.32.4",
  format: "esm",
  globalName: "ap.link.language",
  charset: "ascii",
  legalComments: "inline",
});

console.log("Build result:", result);

esbuild.stop();
