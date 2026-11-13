import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

interface Result {
	obsidian?: string;
	suite: string;
	title: string;
	passed: boolean;
	error?: string;
	notes?: string[];
}

/**
 * Writes one row per test plan case to `out` (and the GitHub job summary): the
 * case ID is the start of the test title, e.g. "S1: ...".
 */
export function writeSummary(resultsFile: string, out: string) {
	if (!existsSync(resultsFile)) return;
	const results: Result[] = readFileSync(resultsFile, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
	const rows = results.map((r) => {
		const [id, ...rest] = r.title.split(": ");
		const cell = (text = "") => text.replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 300);
		return `| ${id} | ${r.obsidian ?? ""} | ${cell(rest.join(": "))} | ${r.passed ? "Pass" : "Fail"} | ${cell([r.error, ...(r.notes ?? [])].filter(Boolean).join("; "))} |`;
	});
	const passed = results.filter((r) => r.passed).length;
	const markdown = [
		`## Obsidian test plan, automated run`,
		"",
		`${passed} of ${results.length} passed.`,
		"",
		"| Case | Obsidian | Checks | Result | Error or observation |",
		"| --- | --- | --- | --- | --- |",
		...rows,
		"",
	].join("\n");
	writeFileSync(out, markdown);
	if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
}
