// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { sanitizeHTMLToDom } from "obsidian";
import { markdownPreview, renderMarkdownPreview } from "./markdown_preview";

function render(markdown: string): HTMLDivElement {
	const container = document.createElement("div");
	container.append(renderMarkdownPreview(markdown));
	return container;
}

describe("renderMarkdownPreview", () => {
	it("renders Markdown", () => {
		const container = render("# Title\n\nSome **bold** text.");

		expect(container.querySelector("h1")?.textContent).toBe("Title");
		expect(container.querySelector("strong")?.textContent).toBe("bold");
	});

	it("passes the HTML through Obsidian's sanitizer", () => {
		render("text");

		expect(sanitizeHTMLToDom).toHaveBeenCalledWith("<p>text</p>\n");
	});

	it("removes scripts and event handlers", () => {
		const container = render(
			'<script>alert(1)</script>\n\n<p onclick="alert(2)">x</p>\n\n<svg><a onmouseover="alert(3)">y</a></svg>',
		);

		expect(container.querySelector("script")).toBeNull();
		expect(container.innerHTML).not.toMatch(/\son\w+=/i);
		expect(container.textContent).toContain("x");
	});

	it("replaces images with their alt text so nothing is fetched", () => {
		const container = render(
			'![a tracker](https://example.com/pixel.png)\n\n<img src=x onerror="alert(1)">',
		);

		expect(container.querySelector("img")).toBeNull();
		expect(container.textContent).toContain("a tracker");
	});

	it("removes elements that embed, restyle or submit", () => {
		const container = render(
			[
				'<iframe src="https://example.com"></iframe>',
				'<object data="x"></object>',
				'<embed src="x">',
				'<link rel="stylesheet" href="https://example.com/a.css">',
				"<style>body { display: none }</style>",
				'<form action="https://example.com"><button>Go</button></form>',
				'<base href="https://example.com/">',
			].join("\n\n"),
		);

		expect(
			container.querySelector(
				"iframe, object, embed, link, style, form, base",
			),
		).toBeNull();
	});

	it("removes inline styles and remote media sources", () => {
		const container = render(
			'<div style="background:url(https://example.com/a)">a</div>\n\n<video poster="https://example.com/p.png" src="https://example.com/v.mp4"></video>',
		);

		const video = container.querySelector("video");
		expect(container.querySelector("[style]")).toBeNull();
		expect(video?.hasAttribute("src")).toBe(false);
		expect(video?.hasAttribute("poster")).toBe(false);
	});

	it("removes script URLs but keeps ordinary links", () => {
		const container = render(
			'[bad](javascript:alert(1))\n\n<a href=" JaVaScRiPt:alert(2)">bad</a>\n\n[good](https://obsidian.md)',
		);

		const hrefs = Array.from(container.querySelectorAll("a")).map((a) =>
			a.getAttribute("href"),
		);
		expect(hrefs).toContain("https://obsidian.md");
		expect(hrefs.some((href) => /javascript/i.test(href ?? ""))).toBe(false);
	});
});

describe("markdownPreview action", () => {
	it("renders on mount and on update", () => {
		const node = document.createElement("div");

		const action = markdownPreview(node, "first <img src=x onerror=alert(1)>");
		expect(node.textContent).toContain("first");
		expect(node.querySelector("img")).toBeNull();

		action.update("second");
		expect(node.textContent).toContain("second");
		expect(node.textContent).not.toContain("first");
	});
});
