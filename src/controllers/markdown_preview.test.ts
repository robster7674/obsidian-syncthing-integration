// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { markdownPreview, renderMarkdownPreview } from "./markdown_preview";

function render(markdown: string): HTMLDivElement {
	const container = document.createElement("div");
	container.append(renderMarkdownPreview(markdown));
	return container;
}

function hrefs(container: HTMLElement): (string | null)[] {
	return Array.from(container.querySelectorAll("a")).map((a) =>
		a.getAttribute("href"),
	);
}

describe("renderMarkdownPreview", () => {
	it("renders Markdown", () => {
		const container = render(
			"# Title\n\nSome **bold** and `code`.\n\n2. two\n3. three\n\n| a | b |\n|:-:|--:|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo",
		);

		expect(container.querySelector("h1")?.textContent).toBe("Title");
		expect(container.querySelector("strong")?.textContent).toBe("bold");
		expect(container.querySelector("code")?.textContent).toBe("code");
		expect(container.querySelector("ol")?.getAttribute("start")).toBe("2");
		expect(container.querySelector("th")?.getAttribute("align")).toBe(
			"center",
		);
		const boxes = container.querySelectorAll("input");
		expect(boxes).toHaveLength(2);
		expect(boxes[0].checked).toBe(true);
		expect(boxes[0].disabled).toBe(true);
	});

	it("keeps only allowlisted attributes", () => {
		const container = render(
			'<p class="modal-container" style="position:fixed" id="x" onclick="alert(1)" data-a="b">text</p>\n\n<a href="https://ok.example" ping="https://tracker.example" target="_blank">link</a>',
		);

		const p = container.querySelector("p");
		const a = container.querySelector("a");
		expect(p?.attributes).toHaveLength(0);
		expect(p?.textContent).toBe("text");
		expect(a?.getAttributeNames()).toEqual(["href"]);
	});

	it("drops scripts, embeds, forms and styles with their content", () => {
		const container = render(
			[
				"<script>alert(1)</script>",
				'<iframe src="https://example.com">frame</iframe>',
				'<object data="x">obj</object>',
				'<embed src="x">',
				"<style>body { display: none }</style>",
				"<template><p>hidden</p></template>",
				"<textarea>area</textarea>",
			].join("\n\n"),
		);

		expect(
			container.querySelector(
				"script, iframe, object, embed, style, template, textarea",
			),
		).toBeNull();
		expect(container.textContent?.trim()).toBe("");
	});

	it("unwraps unknown elements but keeps their text", () => {
		const container = render(
			'<form action="https://example.com"><button formaction="https://example.com">Go</button></form>\n\n<link rel="stylesheet" href="https://example.com/a.css"><base href="https://example.com/"><custom-tag>kept</custom-tag>',
		);

		expect(
			container.querySelector("form, button, link, base, custom-tag"),
		).toBeNull();
		expect(container.textContent).toContain("Go");
		expect(container.textContent).toContain("kept");
	});

	it("drops SVG and MathML, which can load or animate resources", () => {
		const container = render(
			[
				'<svg><image href="https://tracker.example/p.png"/></svg>',
				'<svg><use href="https://example.com/s.svg#a"/></svg>',
				'<svg><a><set attributeName="href" to="javascript:alert(1)"/><text>x</text></a></svg>',
				'<svg><filter id="f"><feImage href="https://example.com/i.png"/></filter></svg>',
				"<math><mi>x</mi></math>",
			].join("\n\n"),
		);

		expect(container.querySelector("svg, image, use, set, math")).toBeNull();
		expect(container.innerHTML).not.toContain("example.com");
	});

	it("replaces images with their alt text so nothing is fetched", () => {
		const container = render(
			'![a tracker](https://example.com/pixel.png)\n\n<img src=x onerror="alert(1)">\n\n<video poster="https://example.com/p.png" src="https://example.com/v.mp4"></video>',
		);

		expect(container.querySelector("img, video")).toBeNull();
		expect(container.textContent).toContain("a tracker");
		expect(container.innerHTML).not.toContain("example.com");
	});

	it("keeps web and mail links and drops every other scheme", () => {
		const container = render(
			[
				"[web](https://obsidian.md)",
				"[mail](mailto:someone@example.com)",
				"[js](javascript:alert(1))",
				'<a href="java&#9;script:alert(2)">tab</a>',
				'<a href="&#1;javascript:alert(3)">control</a>',
				'<a href=" JaVaScRiPt:alert(4)">case</a>',
				"[data](data:text/html,hi)",
				"[uri](obsidian://advanced-uri?commandid=x)",
				"[file](file:///etc/passwd)",
				"[relative](../note.md)",
			].join("\n\n"),
		);

		expect(hrefs(container).filter(Boolean)).toEqual([
			"https://obsidian.md/",
			"mailto:someone@example.com",
		]);
		expect(container.textContent).toContain("relative");
	});
});

describe("markdownPreview action", () => {
	it("renders on mount and on update", () => {
		const node = document.createElement("div");

		const action = markdownPreview(
			node,
			"first <img src=x onerror=alert(1)>",
		);
		expect(node.textContent).toContain("first");
		expect(node.querySelector("img")).toBeNull();

		action.update("second");
		expect(node.textContent).toContain("second");
		expect(node.textContent).not.toContain("first");
	});
});
