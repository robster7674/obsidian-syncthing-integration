import { marked } from "marked";
import { sanitizeHTMLToDom } from "obsidian";

const UNSAFE_ELEMENTS =
	"script, style, link, meta, base, iframe, frame, object, embed, form";
const REMOTE_RESOURCE_ATTRIBUTES = ["src", "srcset", "poster", "background"];
const URL_ATTRIBUTES = ["href", "xlink:href", "action", "formaction"];
const SCRIPTABLE_URL = /^\s*(javascript|vbscript|data):/i;

/**
 * Renders Markdown that came from another device, such as a conflict file, for a preview.
 *
 * The HTML goes through Obsidian's sanitizer, then anything that could run code,
 * restyle Obsidian or load a remote resource is removed. Images are replaced by their alt text.
 */
export function renderMarkdownPreview(markdown: string): DocumentFragment {
	const fragment = sanitizeHTMLToDom(
		marked.parse(markdown, { async: false }) as string
	);
	fragment.querySelectorAll(UNSAFE_ELEMENTS).forEach((element) => {
		element.remove();
	});
	fragment.querySelectorAll("img").forEach((image) => {
		image.replaceWith(image.getAttribute("alt") ?? "");
	});
	fragment.querySelectorAll("*").forEach((element) => {
		for (const attribute of Array.from(element.attributes)) {
			const name = attribute.name.toLowerCase();
			if (
				name.startsWith("on") ||
				name === "style" ||
				REMOTE_RESOURCE_ATTRIBUTES.includes(name) ||
				(URL_ATTRIBUTES.includes(name) &&
					SCRIPTABLE_URL.test(attribute.value))
			) {
				element.removeAttribute(attribute.name);
			}
		}
	});
	return fragment;
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
