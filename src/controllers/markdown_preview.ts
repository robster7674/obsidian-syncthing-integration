import { marked } from "marked";

const ALLOWED_ELEMENTS = new Set([
	"a", "b", "blockquote", "br", "code", "del", "details", "div", "em",
	"h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "input", "kbd", "li",
	"mark", "ol", "p", "pre", "s", "span", "strong", "sub", "summary", "sup",
	"table", "tbody", "td", "th", "thead", "tr", "ul",
]);
const DROPPED_ELEMENTS = new Set([
	"embed", "frame", "frameset", "head", "iframe", "math", "noscript",
	"object", "script", "select", "style", "svg", "template", "textarea",
	"title",
]);
const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * Renders Markdown that came from another device, such as a conflict file, for a preview.
 *
 * The HTML is parsed into an inert document, then rebuilt from an allowlist of
 * Markdown elements. The only attributes kept are web and mail link targets,
 * list starts, table alignment and disabled task checkboxes, so nothing in the
 * preview can run code, restyle Obsidian or load a resource. Images become their alt text.
 */
export function renderMarkdownPreview(markdown: string): DocumentFragment {
	const html = marked.parse(markdown, { async: false }) as string;
	const inert = new DOMParser().parseFromString(html, "text/html");
	const fragment = document.createDocumentFragment();
	copyAllowed(inert.body, fragment);
	return fragment;
}

function copyAllowed(source: Node, target: Node): void {
	for (const node of Array.from(source.childNodes)) {
		if (node.nodeType === Node.TEXT_NODE) {
			target.appendChild(document.createTextNode(node.textContent ?? ""));
			continue;
		}
		if (!(node instanceof Element)) continue;
		const tag = node.localName;
		if (DROPPED_ELEMENTS.has(tag)) continue;
		if (tag === "img") {
			target.appendChild(document.createTextNode(node.getAttribute("alt") ?? ""));
			continue;
		}
		if (!ALLOWED_ELEMENTS.has(tag)) {
			copyAllowed(node, target);
			continue;
		}
		const copy = copyElement(node);
		if (!copy) continue;
		copyAllowed(node, copy);
		target.appendChild(copy);
	}
}

function copyElement(element: Element): HTMLElement | null {
	const tag = element.localName;
	if (tag === "input") {
		if (element.getAttribute("type") !== "checkbox") return null;
		const checkbox = document.createElement("input");
		checkbox.type = "checkbox";
		checkbox.checked = element.hasAttribute("checked");
		checkbox.disabled = true;
		return checkbox;
	}
	const copy = document.createElement(tag);
	if (tag === "a") {
		const href = safeLink(element.getAttribute("href"));
		if (href) copy.setAttribute("href", href);
	} else if (tag === "ol") {
		const start = Number.parseInt(element.getAttribute("start") ?? "", 10);
		if (Number.isFinite(start)) copy.setAttribute("start", String(start));
	} else if (tag === "th" || tag === "td") {
		const align = element.getAttribute("align");
		if (align === "left" || align === "center" || align === "right") {
			copy.setAttribute("align", align);
		}
	}
	return copy;
}

function safeLink(href: string | null): string | null {
	if (!href) return null;
	try {
		const url = new URL(href);
		return ALLOWED_LINK_PROTOCOLS.has(url.protocol) ? url.href : null;
	} catch {
		return null;
	}
}

/**
 * Svelte action that keeps `node` filled with {@link renderMarkdownPreview} of `markdown`.
 */
export function markdownPreview(node: HTMLElement, markdown: string) {
	node.replaceChildren(renderMarkdownPreview(markdown));
	return {
		update(next: string) {
			node.replaceChildren(renderMarkdownPreview(next));
		},
	};
}
