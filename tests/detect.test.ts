import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { detectVersions, isPlatformPackage, suggestVersionLabel } from "../src/detect";

describe("detect", () => {
  test("detects multiple manifest types", async () => {
    const dir = mkdtempSync(join(os.tmpdir(), "librarian-detect-"));

    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        dependencies: { hono: "^4.0.0" },
        devDependencies: { typescript: "^5.0.0" },
      }),
    );
    writeFileSync(
      join(dir, "composer.json"),
      JSON.stringify({
        require: { "laravel/framework": "^11.0" },
        "require-dev": { phpunit: "^10.0" },
      }),
    );
    writeFileSync(
      join(dir, "pyproject.toml"),
      `[tool.poetry.dependencies]\npython = \"^3.11\"\nfastapi = \"^0.110\"\n\n[project]\ndependencies = [\"httpx >= 0.25\"]\n`,
    );
    writeFileSync(join(dir, "requirements.txt"), "requests==2.31.0\n");
    writeFileSync(join(dir, "Pipfile"), "[packages]\nflask = \"==2.3.0\"\n");
    writeFileSync(join(dir, "go.mod"), "module example\nrequire github.com/pkg/errors v0.9.1\n");
    writeFileSync(
      join(dir, "Cargo.toml"),
      `[dependencies]\nserde = \"1.0\"\nreqwest = { version = \"0.11\" }\n`,
    );
    writeFileSync(join(dir, "Gemfile"), "gem \"rails\", \"~> 7.1\"\n");
    writeFileSync(
      join(dir, "pom.xml"),
      "<dependencies><dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><version>5.10.0</version></dependency></dependencies>",
    );
    writeFileSync(
      join(dir, "build.gradle"),
      "dependencies { implementation 'com.squareup.okhttp3:okhttp:4.12.0' }",
    );

    const detected = await detectVersions(dir);
    const names = new Set(detected.map((d) => d.name));
    expect(names.has("hono")).toBe(true);
    expect(names.has("laravel/framework")).toBe(true);
    expect(names.has("fastapi")).toBe(true);
    expect(names.has("httpx")).toBe(true);
    expect(names.has("requests")).toBe(true);
    expect(names.has("flask")).toBe(true);
    expect(names.has("github.com/pkg/errors")).toBe(true);
    expect(names.has("serde")).toBe(true);
    expect(names.has("reqwest")).toBe(true);
    expect(names.has("rails")).toBe(true);
    expect(names.has("org.junit.jupiter:junit-jupiter")).toBe(true);
    expect(names.has("com.squareup.okhttp3:okhttp")).toBe(true);
    expect(names.has("typescript")).toBe(false);
    expect(names.has("phpunit")).toBe(false);
  });

  test("detects platform packages", () => {
    expect(isPlatformPackage("sqlite-vec-darwin-arm64")).toBe(true);
    expect(isPlatformPackage("foo-linux-x64")).toBe(true);
    expect(isPlatformPackage("simple")).toBe(false);
  });

  test("suggests version labels", () => {
    expect(suggestVersionLabel("^4.0.0")).toBe("4.x");
    expect(suggestVersionLabel("v16.2.3")).toBe("16.x");
    expect(suggestVersionLabel(">= 0.25")).toBe("0.x");
    expect(suggestVersionLabel("*")).toBeNull();
  });
});
