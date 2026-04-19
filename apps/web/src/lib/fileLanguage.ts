import { cssLanguage } from "@codemirror/lang-css";
import { htmlLanguage } from "@codemirror/lang-html";
import {
  javascriptLanguage,
  jsxLanguage,
  tsxLanguage,
  typescriptLanguage,
} from "@codemirror/lang-javascript";
import { jsonLanguage } from "@codemirror/lang-json";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { xmlLanguage } from "@codemirror/lang-xml";
import { yamlLanguage } from "@codemirror/lang-yaml";
import { Language, LanguageSupport } from "@codemirror/language";

function support(language: Language): LanguageSupport {
  return new LanguageSupport(language);
}

export function languageSupportForPath(pathValue: string): LanguageSupport | null {
  const lower = pathValue.toLowerCase();

  if (lower.endsWith(".tsx")) return support(tsxLanguage);
  if (lower.endsWith(".ts")) return support(typescriptLanguage);
  if (lower.endsWith(".jsx")) return support(jsxLanguage);
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return support(javascriptLanguage);
  }
  if (lower.endsWith(".json")) return support(jsonLanguage);
  if (lower.endsWith(".md") || lower.endsWith(".mdx")) return support(markdownLanguage);
  if (lower.endsWith(".css")) return support(cssLanguage);
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return support(htmlLanguage);
  if (lower.endsWith(".xml") || lower.endsWith(".svg")) return support(xmlLanguage);
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return support(yamlLanguage);

  return null;
}
